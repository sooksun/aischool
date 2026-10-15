// P5 portfolio_portable: the owner exports their whole accepted portfolio; the
// worker builds a zip (scanned originals + manifest.json + README); a short
// download link is given only when ready; others have no route.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { hash as argonHash } from '@node-rs/argon2';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import yauzl from 'yauzl';
import { buildServer } from '../dist/server.js';
import { runOnce } from '../../worker/dist/loop.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
let app, env, school, categoryId;
const token = {};
const user = {};
let s3;

async function userWith(key, role, { personnel = true } = {}) {
  const password = `exp-${key}-pass-1234`;
  const u = await prisma.userAccount.create({
    data: { person: { create: { displayName: key } }, email: `exp-${key}-${randomUUID()}@x.io`, displayName: key, status: 'active', passwordHash: await argonHash(password) },
  });
  await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  if (personnel) await prisma.personnelProfile.create({ data: { schoolId: school.id, userId: u.id, personId: u.personId, fullName: key, positionRole: 'teacher', rankLevelCode: 'exp_kru' } });
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: u.email, password } });
  token[key] = login.json().access_token;
  user[key] = u;
}
const h = (key, extra = {}) => ({ authorization: `Bearer ${token[key]}`, 'x-school-id': school.id, ...extra });
// A few passes: one pass claims only the 10 oldest due jobs, and a local queue
// may hold unrelated retries ahead of ours.
const worker = async () => { for (let i = 0; i < 3; i++) await runOnce(env, s3, { scheduleGc: false }); };

function unzip(buf) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const out = {};
      zip.readEntry();
      zip.on('entry', (e) => zip.openReadStream(e, (er, rs) => {
        if (er) return reject(er);
        const chunks = [];
        rs.on('data', (c) => chunks.push(c)).on('end', () => { out[e.fileName] = Buffer.concat(chunks); zip.readEntry(); });
      }));
      zip.on('end', () => resolve(out));
    });
  });
}

before(async () => {
  ({ app, env } = await buildServer());
  await app.ready();
  s3 = new S3Client({
    region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }, // gitleaks:allow — field name only; the value comes from the environment
  });
  school = created.add(await prisma.school.create({ data: { code: `exp-${randomUUID()}`, name: 'Export School' } }));
  await prisma.rankLevel.upsert({ where: { code: 'exp_kru' }, create: { code: 'exp_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {} });
  categoryId = (await prisma.evidenceCategory.findFirstOrThrow()).id;
  await userWith('teacher', 'teacher');
  await userWith('peer', 'teacher');
  await userWith('admin', 'school_admin', { personnel: false });
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

test('the owner exports their portfolio: zip with scanned originals, manifest and README; nobody else can see it', async () => {
  // A note, and an item with one verified scanned file (Thai filename) and one blocked file.
  await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: h('teacher', { 'idempotency-key': randomUUID() }),
    payload: { category_id: categoryId, title: 'บันทึกหลังสอน', kind: 'note', note_text: 'อ่านคล่องขึ้น', client_uuid: randomUUID(), contains_learners: 'no' },
  });
  const ev = await prisma.evidence.create({
    data: { originSchoolId: school.id, ownerPersonId: user.teacher.personId, uploadedByUserId: user.teacher.id, categoryId, title: 'แผนการสอน/หน่วยที่ 1', status: 'active', ownerAcceptedAt: new Date() },
  });
  const bytes = Buffer.from('%PDF-1.4 export test');
  const key = `evidence/${school.id}/${ev.id}/${randomUUID()}/plan.pdf`;
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: bytes, ContentType: 'application/pdf' }));
  const sha = createHash('sha256').update(bytes).digest('hex');
  await prisma.evidenceFile.create({ data: { evidenceId: ev.id, storageProvider: 's3_compatible', storageUri: key, contentType: 'application/pdf', byteSize: BigInt(bytes.length), checksumSha256: sha, sha256VerifiedAt: new Date(), scanStatus: 'clean', originalFilename: 'แผนการสอน.pdf' } });
  await prisma.evidenceFile.create({ data: { evidenceId: ev.id, storageProvider: 's3_compatible', storageUri: `${key}.bad`, contentType: 'application/pdf', byteSize: 1n, checksumSha256: 'b'.repeat(64), scanStatus: 'blocked', originalFilename: 'virus.pdf' } });

  const create = await app.inject({ method: 'POST', url: '/api/v1/exports', headers: h('teacher', { 'idempotency-key': randomUUID() }), payload: { kind: 'portfolio_portable' } });
  assert.equal(create.statusCode, 202, create.body);
  const id = create.json().id;
  const early = await app.inject({ method: 'GET', url: `/api/v1/exports/${id}/download-url`, headers: h('teacher') });
  assert.equal(early.statusCode, 409);
  assert.equal(early.json().code, 'EXP-002');

  await worker();
  const got = (await app.inject({ method: 'GET', url: `/api/v1/exports/${id}`, headers: h('teacher') })).json();
  assert.equal(got.status, 'ready', JSON.stringify(got));
  assert.ok(got.sha256 && got.byte_size > 0 && got.expires_at);

  const link = (await app.inject({ method: 'GET', url: `/api/v1/exports/${id}/download-url`, headers: h('teacher') })).json();
  const zipBytes = Buffer.from(await (await fetch(link.download_url)).arrayBuffer());
  assert.equal(createHash('sha256').update(zipBytes).digest('hex'), got.sha256, 'what is served is what was hashed');
  const files = await unzip(zipBytes);
  const names = Object.keys(files);
  assert.ok(names.includes('manifest.json') && names.includes('README.txt'));
  const pdf = names.find((n) => n.endsWith('แผนการสอน.pdf'));
  assert.ok(pdf, `Thai filename kept (got ${names})`);
  assert.ok(!pdf.includes('/หน่วย') || pdf.split('/').length === 3, 'a "/" in a title does not make a folder');
  assert.deepEqual(files[pdf], bytes);
  assert.ok(!names.some((n) => n.includes('virus')), 'blocked files are left out');
  const manifest = JSON.parse(files['manifest.json'].toString('utf8'));
  assert.equal(manifest.person_id, user.teacher.personId);
  const item = manifest.items.find((i) => i.id === ev.id);
  assert.equal(item.files[0].sha256, sha);
  assert.ok(manifest.items.some((i) => i.kind === 'note' && i.note_text === 'อ่านคล่องขึ้น'));

  // Others: a peer has no route; the school admin sees it (school grant) and is audited downloading it.
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/exports/${id}`, headers: h('peer') })).statusCode, 404);
  assert.ok(!(await app.inject({ method: 'GET', url: '/api/v1/exports', headers: h('peer') })).json().items.some((e) => e.id === id));
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/exports/${id}/download-url`, headers: h('admin') })).statusCode, 200);
  assert.ok(await prisma.auditEvent.findFirst({ where: { entityId: id, action: 'export_downloaded' } }));

  // The owner is told it is ready.
  await worker();
  const inbox = (await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: h('teacher') })).json();
  assert.ok(inbox.items.some((n) => n.kind === 'export_ready'), JSON.stringify(inbox.items.map((n) => n.kind)));
});

test('not yet available kinds are VAL-002; a peer cannot export someone else', async () => {
  const dpa = await app.inject({ method: 'POST', url: '/api/v1/exports', headers: h('teacher', { 'idempotency-key': randomUUID() }), payload: { kind: 'dpa_pack' } });
  assert.equal(dpa.statusCode, 422);
  const other = await app.inject({ method: 'POST', url: '/api/v1/exports', headers: h('peer', { 'idempotency-key': randomUUID() }), payload: { kind: 'portfolio_portable', person_id: user.teacher.personId } });
  assert.ok([403, 404].includes(other.statusCode), other.body);
});

test('an expired export is removed by the GC and can no longer be downloaded', async () => {
  const create = await app.inject({ method: 'POST', url: '/api/v1/exports', headers: h('teacher', { 'idempotency-key': randomUUID() }), payload: { kind: 'portfolio_portable' } });
  await worker();
  const id = create.json().id;
  await prisma.exportPackage.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/exports/${id}`, headers: h('teacher') })).json().status, 'expired');
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/exports/${id}/download-url`, headers: h('teacher') })).json().code, 'EXP-002');
  const { processStorageGc } = await import('../../worker/dist/jobs/storage-gc.js');
  await processStorageGc({ ...env, WORKER_GC_AFTER_DAYS: 30 }, s3);
  const row = await prisma.exportPackage.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, 'expired');
  assert.equal(row.storageUri, null);
});
