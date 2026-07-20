// Regression: an 'own'-scoped caller with NO resolvable PersonnelProfile must
// fail closed, never fall through to an unfiltered query (2026-07-18 audit).
//
// Why this file exists separately from permission-matrix.test.mjs: that sweep
// gives every school-scoped role a personnel profile (it has to — 'own' grants
// only mean something when the role CAN own something), so it structurally
// cannot reach the null-personnel path. The bug it missed:
//
//   listEvidence:    ownerFilter = grant === 'own' ? auth.personnel?.id : ...
//   listAssignments: if (grant === 'own') evaluateePersonnelId = auth.personnel?.id
//
// `?.` yields undefined, Prisma omits an `undefined` where-clause entirely, and
// the 'own' scope silently widens to the whole school.
//
// The state is reachable through ordinary HR activity, not an attack: auth.ts
// resolves personnel via `status: 'active'` (identity.ts), while SchoolMembership
// carries its own independent status. Deactivating a profile on transfer,
// retirement, or suspension — WITHOUT also ending the membership — flips the
// caller from "sees own" to "sees everything". Nothing in the schema couples the
// two statuses, so this is a normal state, and the widening is the opposite of
// what deactivation should do.
//
// Contract: PERM-001, matching the existing correct guard in reports.ts.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../../apps/api/dist/server.js';
import { cleanupSchools, trackSchools } from '../helpers/db-cleanup.mjs';

const created = trackSchools();

const prisma = new PrismaClient();
let app;
let school, roundId;
let victimEvidenceId, victimAssignmentId;
let orphanToken;

const PASSWORD = 'own-scope-null-personnel-password';

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  school = created.add(await prisma.school.create({
    data: { code: `nullpers-${randomUUID()}`, name: 'Null Personnel School' },
  }));
  await prisma.rankLevel.upsert({
    where: { code: 'nullpers_kru' },
    create: { code: 'nullpers_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 },
    update: {},
  });
  const category = await prisma.evidenceCategory.create({
    data: { code: `nullpers-cat-${randomUUID()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] },
  });

  // --- VICTIM: an ordinary active teacher whose data must stay private ---
  const victim = await prisma.userAccount.create({
    data: {
      email: `nullpers-victim-${randomUUID()}@x.io`, displayName: 'Victim',
      status: 'active', passwordHash: await argonHash(PASSWORD),
    },
  });
  const victimPersonnel = await prisma.personnelProfile.create({
    data: {
      schoolId: school.id, userId: victim.id, fullName: 'Victim Teacher',
      positionRole: 'teacher', rankLevelCode: 'nullpers_kru',
    },
  });
  const evidence = await prisma.evidence.create({
    data: {
      school: { connect: { id: school.id } },
      owner: { connect: { id: victimPersonnel.id } },
      category: { connect: { id: category.id } },
      uploadedBy: { connect: { id: victim.id } },
      title: 'VICTIM PRIVATE EVIDENCE', status: 'active',
    },
  });
  victimEvidenceId = evidence.id;

  // --- ORPHAN CALLER: membership still active, personnel profile deactivated ---
  const orphan = await prisma.userAccount.create({
    data: {
      email: `nullpers-orphan-${randomUUID()}@x.io`, displayName: 'Orphan',
      status: 'active', passwordHash: await argonHash(PASSWORD),
    },
  });
  await prisma.personnelProfile.create({
    data: {
      schoolId: school.id, userId: orphan.id, fullName: 'Transferred Teacher',
      positionRole: 'teacher', rankLevelCode: 'nullpers_kru',
      status: 'inactive', // HR deactivation — transfer / retirement / suspension
    },
  });
  await prisma.schoolMembership.create({
    data: {
      userId: orphan.id, schoolId: school.id, role: 'teacher', membershipScope: 'school',
      effectiveFrom: new Date('2020-01-01'), status: 'active', // membership NOT ended
    },
  });

  // A round + assignment over the victim, so listAssignments has real data to leak.
  const fw = await prisma.frameworkVersion.upsert({
    where: { code: `nullpers-fw-${process.pid}` },
    create: {
      code: `nullpers-fw-${process.pid}`, roleFamily: 'teacher', legalRef: 'x',
      revisionYear: 9999, status: 'draft', effectiveFrom: new Date(),
    },
    update: {},
  });
  const cycle = await prisma.evaluationCycle.create({
    data: {
      schoolId: school.id, frameworkVersionId: fw.id, fiscalYear: 9999, evaluationKind: 'pa',
      title: 'null personnel cycle', startsOn: new Date('2026-01-01'), endsOn: new Date('2026-12-31'),
    },
  });
  const round = await prisma.evaluationRound.create({
    data: {
      cycleId: cycle.id, roundNumber: 1, purpose: 'regression',
      periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'),
    },
  });
  roundId = round.id;

  const evaluatorIds = [];
  for (let seat = 1; seat <= 3; seat += 1) {
    const evaluator = await prisma.userAccount.create({
      data: {
        email: `nullpers-eval${seat}-${randomUUID()}@x.io`, displayName: `eval${seat}`,
        status: 'active', passwordHash: await argonHash(PASSWORD),
      },
    });
    await prisma.schoolMembership.create({
      data: {
        userId: evaluator.id, schoolId: school.id, role: 'evaluator', membershipScope: 'school',
        effectiveFrom: new Date('2020-01-01'), status: 'active',
      },
    });
    evaluatorIds.push(evaluator.id);
  }
  const assignment = await prisma.evaluationAssignment.create({
    data: {
      schoolId: school.id, roundId: round.id, evaluateePersonnelId: victimPersonnel.id,
      committee: {
        createMany: {
          data: [
            { evaluatorUserId: evaluatorIds[0], committeeRole: 'chair', seatNumber: 1 },
            { evaluatorUserId: evaluatorIds[1], committeeRole: 'member', seatNumber: 2 },
            { evaluatorUserId: evaluatorIds[2], committeeRole: 'member', seatNumber: 3 },
          ],
        },
      },
    },
  });
  victimAssignmentId = assignment.id;

  const login = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { email: orphan.email, password: PASSWORD },
  });
  assert.equal(login.statusCode, 200, 'setup: an active membership must still authenticate');
  orphanToken = login.json().access_token;
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds());
  await app.close();
  await prisma.$disconnect();
});

test('the fixture really does produce a null personnel context (guards the guard)', async () => {
  const me = await app.inject({
    method: 'GET', url: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${orphanToken}` },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(
    me.json().personnel, null,
    'if this ever becomes non-null the two tests below stop testing anything',
  );
});

test('listEvidence: own-scoped caller with no personnel profile is denied, not widened', async () => {
  const res = await app.inject({
    method: 'GET', url: '/api/v1/evidence',
    headers: { authorization: `Bearer ${orphanToken}`, 'x-school-id': school.id },
  });

  const leaked = (res.json().items ?? []).some((e) => e.id === victimEvidenceId);
  assert.equal(leaked, false, "own-scoped caller must never receive another owner's evidence");
  assert.equal(res.statusCode, 403, 'must fail closed');
  assert.equal(res.json().code, 'PERM-001');
});

test('listAssignments: own-scoped caller with no personnel profile is denied, not widened', async () => {
  const res = await app.inject({
    method: 'GET', url: `/api/v1/rounds/${roundId}/assignments`,
    headers: { authorization: `Bearer ${orphanToken}`, 'x-school-id': school.id },
  });

  const leaked = (res.json().items ?? []).some((a) => a.id === victimAssignmentId);
  assert.equal(leaked, false, "own-scoped caller must never receive another evaluatee's assignment");
  assert.equal(res.statusCode, 403, 'must fail closed');
  assert.equal(res.json().code, 'PERM-001');
});
