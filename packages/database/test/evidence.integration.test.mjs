// Proves SEC-TEN-1 at the repository layer: a cross-school id returns null, never
// another school's row. Runs against the real dev Postgres (docker-compose), against
// the BUILT package (../dist) — the same artifact apps/api actually imports, so this
// tests the shipped behavior, not a separate source-execution path.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  prisma, createEvidence, getEvidenceDetail, updateEvidence, listEvidence,
  createEvidenceFile, markEvidenceActiveIfDraft, createMapping, getMappingForAction, confirmMapping,
} from '../dist/index.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

// Frameworks here are created inside a test, not in before(), so they get their
// own tracker rather than being threaded through the school one.
const createdFrameworks = trackSchools();

let schoolA, schoolB, userId, categoryId, personnelA;

before(async () => {
  schoolA = (await prisma.school.create({ data: { code: `sA-${randomUUID()}`, name: 'A' } })).id;
  schoolB = (await prisma.school.create({ data: { code: `sB-${randomUUID()}`, name: 'B' } })).id;
  userId = (await prisma.userAccount.create({ data: { email: `t-${randomUUID()}@x.io`, displayName: 'T', status: 'active' } })).id;
  await prisma.rankLevel.upsert({
    where: { code: 'itest_kru' },
    create: { code: 'itest_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 },
    update: {},
  });
  personnelA = (await prisma.personnelProfile.create({
    data: { schoolId: schoolA, userId, fullName: 'P', positionRole: 'teacher', rankLevelCode: 'itest_kru' },
  })).id;
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

test('getEvidenceDetail returns null for a cross-school id (RES-001 by construction)', async () => {
  const ev = await createEvidence(schoolA, { ownerPersonnelId: personnelA, uploadedByUserId: userId, categoryId, title: 'x' });
  assert.equal(await getEvidenceDetail(schoolB, ev.id), null, 'evidence created in school A must be invisible from school B');
  const sameSchool = await getEvidenceDetail(schoolA, ev.id);
  assert.equal(sameSchool.id, ev.id);
});

test("updateEvidence cannot silently write another tenant's row", async () => {
  const ev = await createEvidence(schoolA, { ownerPersonnelId: personnelA, uploadedByUserId: userId, categoryId, title: 'original' });
  assert.equal(await updateEvidence(schoolB, ev.id, { title: 'HACKED' }), null);
  const after = await getEvidenceDetail(schoolA, ev.id);
  assert.equal(after.title, 'original');
});

test('listEvidence never crosses schools even with matching filters', async () => {
  await createEvidence(schoolA, { ownerPersonnelId: personnelA, uploadedByUserId: userId, categoryId, title: 'in-A' });
  const { items } = await listEvidence(schoolB, { page: 1, pageSize: 50 });
  assert.ok(items.every((i) => i.schoolId === schoolB));
  assert.ok(!items.some((i) => i.title === 'in-A'));
});

test('evidence lifecycle: draft on create, first completed file promotes to active (CCR-002)', async () => {
  const ev = await createEvidence(schoolA, { ownerPersonnelId: personnelA, uploadedByUserId: userId, categoryId, title: 'lifecycle' });
  assert.equal(ev.status, 'draft');
  await createEvidenceFile({
    id: randomUUID(), evidenceId: ev.id, storageUri: `evidence/${schoolA}/${ev.id}/f1.pdf`,
    contentType: 'application/pdf', byteSize: 1024n, checksumSha256: 'a'.repeat(64),
    durationSeconds: null, originalFilename: 'f1.pdf',
  });
  await markEvidenceActiveIfDraft(schoolA, ev.id);
  const after = await getEvidenceDetail(schoolA, ev.id);
  assert.equal(after.status, 'active');
  assert.equal(after.files.length, 1);
});

test('createEvidenceFile rejects a duplicate file id (UPL-004 signal: P2002 on the PK)', async () => {
  const ev = await createEvidence(schoolA, { ownerPersonnelId: personnelA, uploadedByUserId: userId, categoryId, title: 'dup' });
  const fileId = randomUUID();
  const make = () => createEvidenceFile({
    id: fileId, evidenceId: ev.id, storageUri: 'x', contentType: 'application/pdf',
    byteSize: 1n, checksumSha256: 'b'.repeat(64), durationSeconds: null, originalFilename: 'x.pdf',
  });
  await make();
  await assert.rejects(make(), (e) => e.code === 'P2002');
});

test('mapping governance: suggested -> confirmed; duplicate active mapping rejected (MAP-001 signal)', async () => {
  const ev = await createEvidence(schoolA, { ownerPersonnelId: personnelA, uploadedByUserId: userId, categoryId, title: 'map-test' });
  const fw = createdFrameworks.addFramework(await prisma.frameworkVersion.upsert({
    where: { code: `itest-fw-${process.pid}` },
    create: { code: `itest-fw-${process.pid}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
    update: {},
  }));
  const domain = await prisma.evaluationDomain.create({
    data: { frameworkVersionId: fw.id, code: `D-${randomUUID()}`, nameTh: 'd', sortOrder: 1, part: 'standards' },
  });
  const indicator = await prisma.indicator.create({
    data: { domainId: domain.id, frameworkVersionId: fw.id, code: `I-${randomUUID()}`, nameTh: 'i', sortOrder: 1, isScored: true, indicatorKind: 'standard' },
  });

  const mapping = await createMapping(schoolA, { evidenceId: ev.id, indicatorId: indicator.id, cycleId: null, mappedByUserId: userId, rationale: null });
  assert.equal(mapping.status, 'suggested');

  await assert.rejects(
    createMapping(schoolA, { evidenceId: ev.id, indicatorId: indicator.id, cycleId: null, mappedByUserId: userId, rationale: null }),
    (e) => e.code === 'P2002',
  );

  assert.equal(await confirmMapping(mapping.id, userId), true);
  const row = await getMappingForAction(mapping.id);
  assert.equal(row.status, 'confirmed');
  assert.equal(await confirmMapping(mapping.id, userId), false, 're-confirming an already-confirmed mapping must be a no-op');
});
