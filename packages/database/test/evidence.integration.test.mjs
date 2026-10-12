// Repository-layer behaviour of person-owned evidence (ADR-0015, CCR-017): scoped
// listing, client_uuid dedupe, version CAS, and the two-tier mapping state
// machine. Authorization lives in apps/api (evidence-access.ts) — the repository
// reads by id and the API decides. Runs against the real dev Postgres, against
// the BUILT package (../dist) — the same artifact apps/api actually imports, so this
// tests the shipped behavior, not a separate source-execution path.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  prisma, createEvidence, getEvidenceDetail, updateEvidence, listEvidence,
  createEvidenceFile, markEvidenceActiveIfDraft, createOwnerMapping, getMappingById,
  validateMapping, returnMapping, revokeMapping, softDeleteEvidence,
} from '../dist/index.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

// Frameworks here are created inside a test, not in before(), so they get their
// own tracker rather than being threaded through the school one.
const createdFrameworks = trackSchools();

let schoolA, schoolB, userId, personId, categoryId;

before(async () => {
  schoolA = (await prisma.school.create({ data: { code: `sA-${randomUUID()}`, name: 'A' } })).id;
  schoolB = (await prisma.school.create({ data: { code: `sB-${randomUUID()}`, name: 'B' } })).id;
  const user = await prisma.userAccount.create({
    data: { email: `t-${randomUUID()}@x.io`, displayName: 'T', status: 'active', person: { create: { displayName: 'T' } } },
  });
  userId = user.id;
  personId = user.personId;
  await prisma.rankLevel.upsert({
    where: { code: 'itest_kru' },
    create: { code: 'itest_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 },
    update: {},
  });
  await prisma.personnelProfile.create({
    data: { schoolId: schoolA, userId, personId, fullName: 'P', positionRole: 'teacher', rankLevelCode: 'itest_kru' },
  });
  categoryId = (await prisma.evidenceCategory.upsert({
    where: { code: `itest-cat-${Date.now()}` },
    create: { code: `itest-cat-${Date.now()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] },
    update: {},
  })).id;
});

after(async () => {
  // This suite was the single largest source of orphaned evidence in the dev
  // database: `createEvidenceFile` here writes a `storage_uri` for an object that
  // is never uploaded, so the row describes bytes that have never existed. 45 of
  // the 46 orphans found by the first full-store ADR-0009 sweep came from these
  // `lifecycle` / `dup` / `y` fixtures. The rows are harmless to this test and
  // corrosive to everything that reads the store afterwards.
  await cleanupSchools(prisma, [schoolA, schoolB], [], createdFrameworks.frameworkIds());
  await prisma.$disconnect();
});

const mk = async (title, extra = {}) => (await createEvidence({
  ownerPersonId: personId, controllerAreaId: null, originSchoolId: schoolA, uploadedByUserId: userId,
  categoryId, kind: 'file', title, containsLearners: 'unknown', clientUuid: randomUUID(), ...extra,
})).row;

test('createEvidence dedupes on (owner, client_uuid) — an offline replay returns the same row', async () => {
  const clientUuid = randomUUID();
  const first = await createEvidence({
    ownerPersonId: personId, controllerAreaId: null, originSchoolId: schoolA, uploadedByUserId: userId,
    categoryId, kind: 'file', title: 'once', containsLearners: 'unknown', clientUuid,
  });
  const again = await createEvidence({
    ownerPersonId: personId, controllerAreaId: null, originSchoolId: schoolA, uploadedByUserId: userId,
    categoryId, kind: 'file', title: 'once', containsLearners: 'unknown', clientUuid,
  });
  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true);
  assert.equal(again.row.id, first.row.id);
});

test('listEvidence refuses an unscoped query and never crosses origin schools', async () => {
  await assert.rejects(listEvidence({ page: 1, pageSize: 10 }), /scope/);
  await mk('in-A');
  const { items } = await listEvidence({ originSchoolId: schoolB, page: 1, pageSize: 50 });
  assert.ok(!items.some((i) => i.title === 'in-A'));
  const mine = await listEvidence({ ownerPersonId: personId, page: 1, pageSize: 50 });
  assert.ok(mine.items.some((i) => i.title === 'in-A'));
});

test('updateEvidence / softDeleteEvidence are compare-and-swap on version', async () => {
  const ev = await mk('original');
  const stale = await updateEvidence(ev.id, ev.version + 5, { title: 'HACKED' });
  assert.deepEqual(stale, { ok: false, reason: 'stale' });
  const ok = await updateEvidence(ev.id, ev.version, { title: 'renamed' });
  assert.equal(ok.ok, true);
  assert.equal(ok.row.title, 'renamed');
  assert.equal(ok.row.version, ev.version + 1);
  assert.equal((await softDeleteEvidence(ev.id, ev.version)).ok, false, 'old version must not delete');
  assert.equal((await softDeleteEvidence(ev.id, ok.row.version)).ok, true);
  assert.equal(await getEvidenceDetail(ev.id), null);
});

test('evidence lifecycle: draft on create, first completed file promotes to active (CCR-002)', async () => {
  const ev = await mk('lifecycle');
  assert.equal(ev.status, 'draft');
  await createEvidenceFile({
    id: randomUUID(), evidenceId: ev.id, storageUri: `evidence/${schoolA}/${ev.id}/f1.pdf`,
    contentType: 'application/pdf', byteSize: 1024n, checksumSha256: 'a'.repeat(64),
    durationSeconds: null, originalFilename: 'f1.pdf',
  });
  await markEvidenceActiveIfDraft(ev.id);
  const after = await getEvidenceDetail(ev.id);
  assert.equal(after.status, 'active');
  assert.equal(after.files.length, 1);
});

test('link / note evidence is created active (no bytes to wait for)', async () => {
  const ev = await mk('a link', { kind: 'link', linkUrl: 'https://example.org/x' });
  assert.equal(ev.status, 'active');
});

test('createEvidenceFile rejects a duplicate file id (UPL-004 signal: P2002 on the PK)', async () => {
  const ev = await mk('dup');
  const fileId = randomUUID();
  const make = () => createEvidenceFile({
    id: fileId, evidenceId: ev.id, storageUri: 'x', contentType: 'application/pdf',
    byteSize: 1n, checksumSha256: 'b'.repeat(64), durationSeconds: null, originalFilename: 'x.pdf',
  });
  await make();
  await assert.rejects(make(), (e) => e.code === 'P2002');
});

test('two-tier mapping: owner_confirmed -> validated / returned; one live mapping per framework version (MAP-001 signal)', async () => {
  const ev = await mk('map-test');
  const fw = createdFrameworks.addFramework(await prisma.frameworkVersion.upsert({
    where: { code: `itest-fw-${process.pid}` },
    create: { code: `itest-fw-${process.pid}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
    update: {},
  }));
  const domain = await prisma.evaluationDomain.create({
    data: { frameworkVersionId: fw.id, code: `D-${randomUUID()}`, nameTh: 'd', sortOrder: 1, part: 'standards' },
  });
  const mkIndicator = () => prisma.indicator.create({
    data: { domainId: domain.id, frameworkVersionId: fw.id, code: `I-${randomUUID()}`, nameTh: 'i', sortOrder: 1, isScored: true, indicatorKind: 'standard' },
  });
  const [i1, i2] = [await mkIndicator(), await mkIndicator()];
  const create = (indicatorId) => createOwnerMapping({
    evidenceId: ev.id, originSchoolId: schoolA, indicatorId, frameworkVersionId: fw.id, ownerUserId: userId, source: 'manual',
  });

  const m1 = await create(i1.id);
  assert.equal(m1.status, 'owner_confirmed');
  await assert.rejects(create(i1.id), (e) => e.code === 'P2002');

  const outbox = await prisma.outboxEvent.findFirst({ where: { eventType: 'mapping.owner_confirmed', payload: { path: ['mapping_id'], equals: m1.id } } });
  assert.ok(outbox, 'owner confirmation emits mapping.owner_confirmed in the same transaction');

  assert.deepEqual(await validateMapping(m1.id, m1.version + 1, { userId, role: 'director' }), { ok: false, reason: 'stale' });
  const v = await validateMapping(m1.id, m1.version, { userId, role: 'director' });
  assert.equal(v.ok, true);
  assert.equal(v.row.status, 'validated');
  assert.equal(v.row.validatorRole, 'director');
  assert.deepEqual(await returnMapping(m1.id, v.row.version, { userId, role: 'director' }, 'x'), { ok: false, reason: 'state' },
    'only an owner_confirmed mapping can be returned');

  const m2 = await create(i2.id);
  const r = await returnMapping(m2.id, m2.version, { userId, role: 'committee' }, 'ไม่ตรงตัวชี้วัด');
  assert.equal(r.row.status, 'returned');
  assert.equal(r.row.returnNote, 'ไม่ตรงตัวชี้วัด');

  const rv = await revokeMapping(m1.id, v.row.version, userId);
  assert.equal(rv.row.status, 'revoked');
  const again = await create(i1.id);
  assert.equal(again.status, 'owner_confirmed', 'a revoked mapping frees the (evidence, indicator, version) slot');
  assert.equal((await getMappingById(m1.id)).status, 'revoked');
});
