// FR-012 / CCR-026: before any bytes move, the client asks whether these exact
// bytes are already in the caller's own portfolio — verified files of live items
// only, and never someone else's.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
let app, school, categoryId;
const sha = createHash('sha256').update(`dup-${randomUUID()}`).digest('hex');

async function teacher() {
  const password = `dp-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: 't' } }, email: `dp-${randomUUID()}@x.io`, displayName: 't', status: 'active', passwordHash: await argonHash(password) },
  });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  const token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token;
  return { user, token };
}
async function item(owner, { verified = true, title = 'แผนการสอน' } = {}) {
  const ev = await prisma.evidence.create({
    data: { originSchoolId: school.id, ownerPersonId: owner.user.personId, uploadedByUserId: owner.user.id, categoryId, title, status: 'active', ownerAcceptedAt: new Date() },
  });
  const file = await prisma.evidenceFile.create({
    data: {
      evidenceId: ev.id, storageUri: `evidence/x/${ev.id}`, contentType: 'application/pdf', byteSize: 10n,
      checksumSha256: sha, originalFilename: 'a.pdf', sha256VerifiedAt: verified ? new Date() : null, scanStatus: 'clean', mediaState: 'ready',
    },
  });
  return { ev, file };
}
const check = (token, checksum = sha) => app.inject({ method: 'GET', url: `/api/v1/me/files/duplicates?checksum_sha256=${checksum}`, headers: { authorization: `Bearer ${token}` } });

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  school = created.add(await prisma.school.create({ data: { code: `dp-${randomUUID()}`, name: 'Dup' } }));
  categoryId = (await prisma.evidenceCategory.create({ data: { code: `dp-cat-${randomUUID()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] } })).id;
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

test('the owner learns of a verified file with the same bytes; nobody else does', async () => {
  const me = await teacher();
  const other = await teacher();
  const { ev } = await item(me);
  await item(me, { verified: false, title: 'ยังไม่ยืนยัน' });

  const mine = await check(me.token);
  assert.equal(mine.statusCode, 200, mine.body);
  assert.deepEqual(mine.json().map((d) => [d.evidence_id, d.title]), [[ev.id, 'แผนการสอน']], 'verified bytes only');
  assert.deepEqual((await check(other.token)).json(), [], "never another person's portfolio");
  assert.equal((await check(me.token, 'nothex')).statusCode, 400);

  await prisma.evidence.update({ where: { id: ev.id }, data: { deletedAt: new Date() } });
  assert.deepEqual((await check(me.token)).json(), [], 'a deleted item is not a duplicate');
});

test("the evidence detail names the item holding the same bytes", async () => {
  const me = await teacher();
  const a = await item(me);
  const b = await item(me, { title: 'ซ้ำ' });
  await prisma.evidenceFile.update({ where: { id: b.file.id }, data: { duplicateOfFileId: a.file.id } });
  const detail = await app.inject({ method: 'GET', url: `/api/v1/evidence/${b.ev.id}`, headers: { authorization: `Bearer ${me.token}` } });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().files[0].duplicate_of_evidence_id, a.ev.id);
});
