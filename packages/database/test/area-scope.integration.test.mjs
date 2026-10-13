// withAreaScope + resolveAreaScope (ADR-0019): the RLS backstop through Prisma.
// tests/backend/rls-backstop.test.mjs proves the policies in raw SQL; this proves
// the helper actually engages them — an ORM query with NO tenant filter inside
// the scope still returns only the caller's area — and that the scope a caller
// gets matches what the API lets them read.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, withAreaScope, resolveAreaScope, listEvidence } from '../dist/index.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

const created = trackSchools();
const areaIds = [];
let areaA, areaB, schoolA, schoolB, teacherA, teacherB, evaluator, evA, evB;

async function teacher(schoolId, tag) {
  const user = await prisma.userAccount.create({
    data: { email: `${tag}-${randomUUID()}@x.io`, displayName: tag, status: 'active', person: { create: { displayName: tag } } },
  });
  const profile = await prisma.personnelProfile.create({
    data: { schoolId, userId: user.id, personId: user.personId, fullName: tag, positionRole: 'teacher', rankLevelCode: 'itest_kru' },
  });
  return { userId: user.id, personId: user.personId, profileId: profile.id };
}

before(async () => {
  areaA = (await prisma.area.create({ data: { code: `aA-${randomUUID()}`, name: 'A' } })).id;
  areaB = (await prisma.area.create({ data: { code: `aB-${randomUUID()}`, name: 'B' } })).id;
  areaIds.push(areaA, areaB);
  schoolA = created.add(await prisma.school.create({ data: { code: `rA-${randomUUID()}`, name: 'A', areaId: areaA } })).id;
  schoolB = created.add(await prisma.school.create({ data: { code: `rB-${randomUUID()}`, name: 'B', areaId: areaB } })).id;
  await prisma.rankLevel.upsert({
    where: { code: 'itest_kru' },
    create: { code: 'itest_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 },
    update: {},
  });
  teacherA = await teacher(schoolA, 'ta');
  teacherB = await teacher(schoolB, 'tb');
  const category = await prisma.evidenceCategory.create({
    data: { code: `scope-cat-${randomUUID()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] },
  });
  const mk = (t, areaId, schoolId) => prisma.evidence.create({
    data: {
      ownerPersonId: t.personId, controllerAreaId: areaId, originSchoolId: schoolId,
      uploadedByUserId: t.userId, categoryId: category.id, title: 'x', status: 'active',
    },
  });
  evA = (await mk(teacherA, areaA, schoolA)).id;
  evB = (await mk(teacherB, areaB, schoolB)).id;

  // An evaluator from area A on a committee for teacher B (area B).
  const ev = await prisma.userAccount.create({
    data: { email: `ev-${randomUUID()}@x.io`, displayName: 'ev', status: 'active', person: { create: { displayName: 'ev' } } },
  });
  evaluator = { userId: ev.id, personId: ev.personId };
  created.addUser(ev.id);
  const fw = created.addFramework(await prisma.frameworkVersion.create({
    data: { code: `scope-fw-${randomUUID()}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
  }));
  const cycle = await prisma.evaluationCycle.create({
    data: {
      schoolId: schoolB, frameworkVersionId: fw.id, fiscalYear: 9999, evaluationKind: 'pa', title: 'c',
      startsOn: new Date('2026-01-01'), endsOn: new Date('2026-12-31'),
    },
  });
  const round = await prisma.evaluationRound.create({
    data: { cycleId: cycle.id, roundNumber: 1, purpose: 'x', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31') },
  });
  await prisma.evaluationAssignment.create({
    data: {
      schoolId: schoolB, roundId: round.id, evaluateePersonnelId: teacherB.profileId,
      committee: { create: [{ evaluatorUserId: evaluator.userId, committeeRole: 'chair', seatNumber: 1 }] },
    },
  });
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await prisma.area.deleteMany({ where: { id: { in: areaIds } } });
  await prisma.$disconnect();
});

test('an ORM query with no tenant filter, inside the scope, returns only the caller\'s area', async () => {
  const scope = await resolveAreaScope({ userId: teacherA.userId, personId: teacherA.personId, schoolIds: [schoolA], areaIds: [] });
  assert.deepEqual(scope.areaIds, [areaA], 'the school\'s area is derived, not supplied');

  const seen = await withAreaScope(scope, (tx) => tx.evidence.findMany({ where: { id: { in: [evA, evB] } }, select: { id: true } }));
  assert.deepEqual(seen.map((e) => e.id), [evA]);

  // The same query outside the scope: the backstop is opt-in, so both rows.
  const unscoped = await prisma.evidence.findMany({ where: { id: { in: [evA, evB] } } });
  assert.equal(unscoped.length, 2);
});

test('listEvidence through the scope: a wrong filter cannot cross the area', async () => {
  const scope = await resolveAreaScope({ userId: teacherA.userId, personId: teacherA.personId, schoolIds: [schoolA], areaIds: [] });
  // A buggy caller passes area B's school as the filter.
  const { items, total } = await withAreaScope(scope, (tx) => listEvidence({ originSchoolId: schoolB, page: 1, pageSize: 20 }, tx));
  assert.equal(total, 0);
  assert.equal(items.length, 0);
});

test('a committee seat across the area boundary keeps the evaluatee\'s portfolio visible', async () => {
  const scope = await resolveAreaScope({ userId: evaluator.userId, personId: evaluator.personId, schoolIds: [schoolA], areaIds: [] });
  assert.ok(scope.personIds.includes(teacherB.personId), 'evaluatee is in scope');
  const seen = await withAreaScope(scope, (tx) => tx.evidence.findMany({ where: { id: { in: [evA, evB] } }, select: { id: true } }));
  assert.deepEqual(new Set(seen.map((e) => e.id)), new Set([evA, evB]));
});

test('writes inside the scope are refused', async () => {
  const scope = await resolveAreaScope({ userId: teacherA.userId, personId: teacherA.personId, schoolIds: [schoolA], areaIds: [] });
  await assert.rejects(
    withAreaScope(scope, (tx) => tx.evidence.update({ where: { id: evA }, data: { title: 'y' } })),
    /permission denied/,
  );
  assert.equal((await prisma.evidence.findUnique({ where: { id: evA } })).title, 'x');
});

test('a non-uuid scope value is rejected before it reaches SQL', async () => {
  await assert.rejects(
    withAreaScope({ areaIds: ["x'}"], schoolIds: [], personIds: [] }, async () => 1),
    /not a uuid/,
  );
});
