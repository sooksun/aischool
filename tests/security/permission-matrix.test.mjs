// Generated-from-contract permission tests (SEC-TEN-5, SEIP-QA-001 §permission-tests).
//
// This does NOT hand-pick scenarios. For every implemented operationId x every
// role, it asks permissions.yaml (via @seip/backend-shared's runtime loader — the
// SAME loader apps/api uses to enforce, not a second copy) whether that role holds
// a grant. If the matrix has no grant, a user holding ONLY that role must be
// rejected with PERM-001. If new code ever adds an operationId without updating
// this file's OPERATIONS map, that operationId is silently excluded from the sweep
// — the "all operationIds have a disposition" invariant is enforced separately by
// scripts/security/validate-contracts.mjs (authz coverage), not here; this file's
// job is proving enforcement matches the matrix for the operations it DOES know
// about, i.e. it complements that gate rather than duplicating it.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { grantFor, isExempt } from '@seip/backend-shared';
import { buildServer } from '../../apps/api/dist/server.js';

const prisma = new PrismaClient();
let app;
const ROLES = ['teacher', 'director', 'deputy', 'evaluator', 'school_admin', 'area_admin'];
const tokenFor = {};
const userIdFor = {};
let secondEvaluatorUserId;
let school, area, evidenceId, indicatorId, mappingId, frameworkId, deletableEvidenceId, categoryId;
let cycleId, roundId, assignmentId, teacherPersonnelId;

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  area = await prisma.area.create({ data: { code: `perm-area-${randomUUID()}`, name: 'Area' } });
  school = await prisma.school.create({ data: { code: `perm-school-${randomUUID()}`, name: 'School', areaId: area.id } });
  await prisma.rankLevel.upsert({
    where: { code: 'perm_kru' }, create: { code: 'perm_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {},
  });

  // One user PER ROLE, holding EXACTLY that one role — so a grant/deny result can
  // only be attributed to that single role, never a role combination. Every
  // school-scoped role also gets a personnel profile: in a real school, teacher,
  // deputy, AND director are all staff (a director evaluating their own DPA is
  // real), and 'own' grants only mean something when the role CAN own something.
  for (const role of ROLES) {
    const password = `perm-test-${role}-password`;
    const user = await prisma.userAccount.create({
      data: { email: `perm-${role}-${randomUUID()}@x.io`, displayName: role, status: 'active', passwordHash: await argonHash(password) },
    });
    if (role === 'area_admin') {
      await prisma.schoolMembership.create({ data: { userId: user.id, areaId: area.id, role, membershipScope: 'area', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
    } else {
      await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
      if (role !== 'school_admin' && role !== 'evaluator') {
        await prisma.personnelProfile.create({ data: { schoolId: school.id, userId: user.id, fullName: role, positionRole: 'teacher', rankLevelCode: 'perm_kru' } });
      }
    }
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } });
    assert.equal(login.statusCode, 200, `setup: ${role} must be able to log in`);
    tokenFor[role] = login.json().access_token;
    userIdFor[role] = user.id;
  }

  // createAssignment's committee needs THREE eligible seats (active evaluator or
  // director membership at the school — 2026-07-18 audit fix), and the per-role
  // fixture has only one of each. A second evaluator account fills seat 3.
  const secondEvaluator = await prisma.userAccount.create({
    data: { email: `perm-evaluator2-${randomUUID()}@x.io`, displayName: 'evaluator2', status: 'active', passwordHash: await argonHash('perm-test-evaluator2-password') },
  });
  await prisma.schoolMembership.create({
    data: { userId: secondEvaluator.id, schoolId: school.id, role: 'evaluator', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  secondEvaluatorUserId = secondEvaluator.id;

  // Real resource ids, created via the teacher (who has genuine grants for these),
  // so every role's requests below hit an ACTUAL resource rather than a 404 that
  // would masquerade as "not a PERM-001 denial" for the wrong reason.
  const category = await prisma.evidenceCategory.upsert({
    where: { code: `perm-cat-${Date.now()}` }, create: { code: `perm-cat-${Date.now()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] }, update: {},
  });
  categoryId = category.id;
  const create = await app.inject({ method: 'POST', url: '/api/v1/evidence', headers: { authorization: `Bearer ${tokenFor.teacher}` }, payload: { category_id: category.id, title: 'perm sweep evidence' } });
  evidenceId = create.json().id;

  const fw = await prisma.frameworkVersion.upsert({
    where: { code: `perm-fw-${process.pid}` }, create: { code: `perm-fw-${process.pid}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() }, update: {},
  });
  frameworkId = fw.id;
  const domain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: `D-${randomUUID()}`, nameTh: 'd', sortOrder: 1, part: 'standards' } });
  const indicator = await prisma.indicator.create({ data: { domainId: domain.id, frameworkVersionId: fw.id, code: `I-${randomUUID()}`, nameTh: 'i', sortOrder: 1, isScored: true, indicatorKind: 'standard' } });
  indicatorId = indicator.id;

  const mapping = await app.inject({ method: 'POST', url: `/api/v1/evidence/${evidenceId}/mappings`, headers: { authorization: `Bearer ${tokenFor.teacher}` }, payload: { indicator_id: indicatorId } });
  mappingId = mapping.json().id;

  // evaluator holds 'committee' grants on getEvidence/listEvidenceMappings — like
  // 'own', necessary but not sufficient: a real committee seat is required, not
  // just the role. Give evaluator an actual seat over OWNER_ROLE (teacher)'s
  // personnel, so the sweep's default "else" branch can prove a genuine member
  // is NOT denied (the negative case — a role holding 'committee' without a real
  // seat — is proven by COMMITTEE_SENSITIVE_OPS below, since no OTHER role in
  // this fixture ever gets a committee seat).
  const teacherPersonnel = await prisma.personnelProfile.findFirstOrThrow({ where: { schoolId: school.id, userId: userIdFor.teacher } });
  const cycle = await prisma.evaluationCycle.create({
    data: { schoolId: school.id, frameworkVersionId: fw.id, fiscalYear: 9999, evaluationKind: 'pa', title: 'perm sweep cycle', startsOn: new Date('2026-01-01'), endsOn: new Date('2026-12-31') },
  });
  const round = await prisma.evaluationRound.create({
    data: { cycleId: cycle.id, roundNumber: 1, purpose: 'perm sweep', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31') },
  });
  const assignment = await prisma.evaluationAssignment.create({
    data: {
      schoolId: school.id, roundId: round.id, evaluateePersonnelId: teacherPersonnel.id,
      committee: { createMany: { data: [
        { evaluatorUserId: userIdFor.evaluator, committeeRole: 'chair', seatNumber: 1 },
        { evaluatorUserId: userIdFor.director, committeeRole: 'member', seatNumber: 2 },
        { evaluatorUserId: userIdFor.school_admin, committeeRole: 'member', seatNumber: 3 },
      ] } },
    },
  });
  cycleId = cycle.id;
  roundId = round.id;
  assignmentId = assignment.id;
  teacherPersonnelId = teacherPersonnel.id;
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

// operationId -> how to build a minimal, resource-valid request. Kept separate
// from apps/api's own route table on purpose: this is the test's independent
// understanding of the contract's shape, not a re-export of the implementation's.
const OPERATIONS = () => ({
  // members / personnel (CCR-014).
  listPersonnel: { method: 'GET', url: '/api/v1/personnel' },
  listMembers: { method: 'GET', url: '/api/v1/members' },
  // A fresh random email per call: a granted role must not fail on RES-002 from
  // a previous role's successful invite in the same sweep.
  inviteMember: { method: 'POST', url: '/api/v1/members', payload: { email: `sweep-${randomUUID()}@x.io`, display_name: 'sweep', role: 'teacher' } },
  // Random membership id → RES-001 for granted roles (never PERM-001), same
  // philosophy as getReport below.
  endMembership: { method: 'POST', url: `/api/v1/members/${randomUUID()}/end` },
  // acceptInvite is NOT swept: permissions.yaml lists it under `unauthenticated:`,
  // so it has no matrix row and no role dimension to sweep. Its security
  // properties — single-use, no-oracle AUTH-005, rate limiting — are covered
  // directly by apps/api/test/onboarding-flow.test.mjs.

  listFrameworks: { method: 'GET', url: '/api/v1/frameworks' },
  getFramework: { method: 'GET', url: `/api/v1/frameworks/${frameworkId}` },
  listEvidenceCategories: { method: 'GET', url: '/api/v1/evidence-categories' },
  listEvidence: { method: 'GET', url: '/api/v1/evidence' },
  createEvidence: { method: 'POST', url: '/api/v1/evidence', payload: { category_id: randomUUID(), title: 'x' } },
  getEvidence: { method: 'GET', url: `/api/v1/evidence/${evidenceId}` },
  updateEvidence: { method: 'PATCH', url: `/api/v1/evidence/${evidenceId}`, payload: { title: 'y' } },
  // No static url: deleteEvidence gets a FRESH, real, teacher-owned throwaway
  // resource per role tested (built in the sweep loop below) — a random/missing
  // id would 404 before the ownership check ever runs, and reusing one real id
  // across roles would let an early role's 204 delete it out from under a later
  // role's check (see the sweep's DELETABLE handling).
  deleteEvidence: { method: 'DELETE', url: null },
  initiateFileUpload: { method: 'POST', url: `/api/v1/evidence/${evidenceId}/files/initiate`, payload: { content_type: 'application/pdf', byte_size: 10, checksum_sha256: 'a'.repeat(64), original_filename: 'x.pdf' } },
  // completeFileUpload and getEvidenceFileDownloadUrl were both absent from this
  // sweep until 2026-07-19 with no justification comment — the audit flagged
  // them as the only unswept matrix rows besides the deliberately-excluded
  // getAssignmentResults, and both sit on the PDPA upload/download surface.
  // A random fileId yields RES-001 for granted roles, never PERM-001, which is
  // all this sweep needs (same philosophy as createMapping/getReport).
  completeFileUpload: { method: 'POST', url: `/api/v1/evidence/${evidenceId}/files/${randomUUID()}/complete`, payload: { content_type: 'application/pdf', byte_size: 10, checksum_sha256: 'a'.repeat(64), original_filename: 'x.pdf' } },
  getEvidenceFileDownloadUrl: { method: 'GET', url: `/api/v1/evidence/${evidenceId}/files/${randomUUID()}/download-url` },
  listEvidenceMappings: { method: 'GET', url: `/api/v1/evidence/${evidenceId}/mappings` },
  createMapping: { method: 'POST', url: `/api/v1/evidence/${evidenceId}/mappings`, payload: { indicator_id: randomUUID() } }, // random indicator: expected to fail VAL-002 for granted roles, never PERM-001
  // Missing framework/cycle → AI-001 for granted roles (not PERM-001).
  suggestMappings: { method: 'POST', url: `/api/v1/evidence/${evidenceId}/mappings/suggest`, payload: {} },
  listMappings: { method: 'GET', url: '/api/v1/mappings' },
  // 'revoke' (not 'reject'): teacher's own-revoke grant permits ONLY revoke, and
  // director/school_admin's 'school' grant permits any action — 'revoke' is the
  // one action every granted role can legally perform, so it exercises "has grant"
  // uniformly without a role-conditional payload.
  actOnMapping: { method: 'PATCH', url: `/api/v1/mappings/${mappingId}`, payload: { action: 'revoke' } },

  listCycles: { method: 'GET', url: '/api/v1/cycles' },
  createCycle: { method: 'POST', url: '/api/v1/cycles', payload: { framework_version_id: frameworkId, fiscal_year: 9998, evaluation_kind: 'pa', title: 'sweep cycle', starts_on: '2026-01-01', ends_on: '2026-12-31' } },
  getCycle: { method: 'GET', url: `/api/v1/cycles/${cycleId}` },
  updateCycle: { method: 'PATCH', url: `/api/v1/cycles/${cycleId}`, payload: { title: 'sweep update' } },
  createRound: { method: 'POST', url: `/api/v1/cycles/${cycleId}/rounds`, payload: { round_number: 1, purpose: 'sweep', period_start: '2026-02-01', period_end: '2026-11-30' } },
  // purpose-only patch: no status field, so CYCLE-001's transition check never
  // engages — this operation's job is proving the PERMISSION layer, not scoring's
  // state machine (already covered by scoring-flow.test.mjs).
  updateRound: { method: 'PATCH', url: `/api/v1/rounds/${roundId}`, payload: { purpose: 'sweep update' } },

  listAssignments: { method: 'GET', url: `/api/v1/rounds/${roundId}/assignments` },
  // Reuses the fixture's own evaluatee/committee shape — a real, VAL-002-free
  // payload so granted roles only ever fail on the (roundId, evaluatee) unique
  // constraint (RES-002, not a permission denial) on the second attempt.
  createAssignment: { method: 'POST', url: `/api/v1/rounds/${roundId}/assignments`, payload: {
    evaluatee_personnel_id: teacherPersonnelId,
    committee: [
      // All three seats hold eligible memberships (evaluator/director at this
      // school — 2026-07-18 audit fix); school_admin no longer qualifies.
      { evaluator_user_id: userIdFor.evaluator, committee_role: 'chair', seat_number: 1 },
      { evaluator_user_id: userIdFor.director, committee_role: 'member', seat_number: 2 },
      { evaluator_user_id: secondEvaluatorUserId, committee_role: 'member', seat_number: 3 },
    ],
  } },
  getAssignment: { method: 'GET', url: `/api/v1/assignments/${assignmentId}` },
  // Round is deliberately left 'planned' (never opened) — a genuine committee
  // member (evaluator/director, both really seated) will fail SCORE-002, an
  // ACCEPTABLE non-permission outcome for this sweep's purposes (same philosophy
  // as createMapping's expected VAL-002 above: "granted -> not blocked by the
  // PERMISSION layer", other-reason failures are fine and expected).
  submitMyScores: { method: 'PUT', url: `/api/v1/assignments/${assignmentId}/my-scores`, payload: { indicator_scores: [{ indicator_id: randomUUID(), rubric_level: 1 }] } },
  // getAssignmentResults is deliberately NOT in this sweep: its 'own' grant
  // (teacher/deputy) carries an EXTRA temporal rule ("visible only once the round
  // is closed", permissions.yaml note) that returns PERM-001 even for the genuine
  // evaluatee on a non-closed round — which would collide with this sweep's
  // "OWNER_ROLE must never see PERM-001" assumption for a reason that has nothing
  // to do with a matrix mismatch. That behavior (including the genuine-evaluatee
  // case, once closed) is covered directly by scoring-flow.test.mjs instead.

  listReports: { method: 'GET', url: '/api/v1/reports' },
  // random subject → RES-001 for granted roles (not PERM-001).
  createReport: { method: 'POST', url: '/api/v1/reports', payload: {
    cycle_id: cycleId,
    subject_personnel_id: randomUUID(),
    template_code: 'PA2_s',
  } },
  // Unknown report id → RES-001 for granted roles that pass ownership loosely;
  // for 'own' roles without a real report, still not PERM-001 if grant exists —
  // getReport needs a real resource for own checks, so use a random uuid:
  // RES-001 before ownership (findFirst by school+id returns null → RES-001).
  getReport: { method: 'GET', url: `/api/v1/reports/${randomUUID()}` },
  // Missing report → RES-001 for granted roles after PERM check.
  getReportPdf: { method: 'GET', url: `/api/v1/reports/${randomUUID()}/pdf` },
});

// The fixture evidence/mapping above is owned by 'teacher', who is ALSO the
// fixture assignment's evaluatee (deliberately, so one OWNER_ROLE constant
// covers both). An 'own' or 'own-revoke' grant is necessary but not sufficient
// — the caller must also BE the owner/evaluatee. Operations below are
// 'own'-sensitive per permissions.yaml; for any role that holds one of these
// grants but isn't OWNER_ROLE, denial is the CORRECT outcome (proves the
// ownership boundary), not a matrix mismatch.
const OWNER_ROLE = 'teacher';
const OWN_SENSITIVE_OPS = new Set([
  'getEvidence', 'updateEvidence', 'deleteEvidence', 'initiateFileUpload',
  // Added 2026-07-19 with the sweep coverage itself. completeFileUpload carries
  // the IDENTICAL matrix row to initiateFileUpload above (teacher/deputy/director
  // all 'own'), and getEvidenceFileDownloadUrl gives deputy 'own' — so for every
  // non-owner holding those grants, PERM-001 is the ownership boundary working,
  // not a matrix mismatch. Enforcement was already correct; only the sweep's
  // knowledge of it was missing, which is precisely what going unswept means.
  'completeFileUpload', 'getEvidenceFileDownloadUrl',
  'listEvidenceMappings', 'createMapping', 'suggestMappings', 'actOnMapping', 'getAssignment',
]);

test('every implemented operation x every role matches its permissions.yaml disposition', async () => {
  const ops = OPERATIONS();
  const failures = [];
  let assertions = 0;

  for (const [operationId, req] of Object.entries(ops)) {
    if (isExempt(operationId)) continue; // login/getCurrentUser not in this sweep — no per-role grant to check

    for (const role of ROLES) {
      const grant = grantFor(operationId, role);

      let url = req.url;
      if (operationId === 'deleteEvidence') {
        // Fresh, real, teacher-owned resource per role — see the OPERATIONS
        // comment above for why a shared or fake id can't test this correctly.
        const throwaway = await app.inject({
          method: 'POST', url: '/api/v1/evidence',
          headers: { authorization: `Bearer ${tokenFor.teacher}` },
          payload: { category_id: categoryId, title: `throwaway for deleteEvidence x ${role}` },
        });
        url = `/api/v1/evidence/${throwaway.json().id}`;
      }

      const res = await app.inject({
        method: req.method, url, headers: { authorization: `Bearer ${tokenFor[role]}`, 'x-school-id': school.id },
        payload: req.payload,
      });
      assertions++;

      // 204 No Content (e.g. a legitimate deleteEvidence by its actual owner) has
      // no body — light-my-request's .json() throws on empty input rather than
      // returning undefined, so guard on status the same way a real client would.
      const body = res.statusCode === 204 ? undefined : res.json();

      if (!grant) {
        // No grant at all: this role must never get past the permission check.
        if (res.statusCode !== 403 || body?.code !== 'PERM-001') {
          failures.push(`${operationId} x ${role}: expected 403 PERM-001 (no grant), got ${res.statusCode} ${body?.code ?? ''}`);
        }
      } else if ((grant === 'own' || grant === 'own-revoke') && OWN_SENSITIVE_OPS.has(operationId) && role !== OWNER_ROLE) {
        // Holds the grant TYPE but isn't the fixture's owner — must still be
        // denied. This is the ownership boundary working, not a matrix gap.
        if (res.statusCode !== 403) {
          failures.push(`${operationId} x ${role}: has '${grant}' but isn't the resource owner — expected 403, got ${res.statusCode}`);
        }
      } else {
        // A grant exists and applies (school-wide, area-read, or owner-matched
        // own/own-revoke) — the request may still fail for other valid reasons
        // (VAL-002 unknown resource, etc.) but must never be a role-permission denial.
        if (res.statusCode === 403 && body?.code === 'PERM-001') {
          failures.push(`${operationId} x ${role}: has grant '${grant}' in permissions.yaml but was denied PERM-001`);
        }
      }
    }
  }

  // 34 of the 35 matrix rows. The one exclusion is getAssignmentResults, whose
  // temporal rule is explained and separately covered above. Raise this number
  // whenever a row is added — a sweep that silently covers less than the matrix
  // is how completeFileUpload and getEvidenceFileDownloadUrl went unswept.
  assert.ok(assertions >= 34 * 6, `sweep should cover at least 34 operations x 6 roles, got ${assertions} assertions`);
  assert.deepEqual(failures, [], `${failures.length} mismatch(es) between permissions.yaml and enforcement:\n${failures.join('\n')}`);
});

test('area_admin is read-only: every write operation denies it even where director/school_admin are granted', async () => {
  const writeOps = ['createEvidence', 'updateEvidence', 'deleteEvidence', 'initiateFileUpload', 'createMapping', 'actOnMapping'];
  const ops = OPERATIONS();
  for (const operationId of writeOps) {
    const grant = grantFor(operationId, 'area_admin');
    assert.notEqual(grant, 'school', `${operationId}: area_admin must never hold a write-capable 'school' grant`);
  }
  // Live-request confirmation for one representative write op (PERM-004 path,
  // not just the static matrix read above).
  const res = await app.inject({
    method: ops.updateEvidence.method, url: ops.updateEvidence.url, payload: ops.updateEvidence.payload,
    headers: { authorization: `Bearer ${tokenFor.area_admin}`, 'x-school-id': school.id },
  });
  assert.equal(res.statusCode, 403);
});

test('X-School-Id header behavior: single membership ignores it safely; multi-membership validates it', async () => {
  const otherSchool = await prisma.school.create({ data: { code: `perm-other-${randomUUID()}`, name: 'Other' } });

  // Single-membership user: per CCR-003, the header is IGNORED (not validated) —
  // the request proceeds under the caller's own real school. A bogus header must
  // NOT leak into otherSchool's data; it must simply have no effect.
  const ignored = await app.inject({
    method: 'GET', url: '/api/v1/evidence',
    headers: { authorization: `Bearer ${tokenFor.teacher}`, 'x-school-id': otherSchool.id },
  });
  assert.equal(ignored.statusCode, 200);
  assert.ok(ignored.json().items.every((i) => i.school_id === school.id), "must resolve to the caller's real school, not the header");

  // Multi-membership user: NOW the header is load-bearing, and a value that
  // matches neither membership must be rejected outright.
  const multiPassword = 'multi-school-password-1234';
  const multiUser = await prisma.userAccount.create({ data: { email: `perm-multi-${randomUUID()}@x.io`, displayName: 'Multi', status: 'active', passwordHash: await argonHash(multiPassword) } });
  await prisma.schoolMembership.create({ data: { userId: multiUser.id, schoolId: school.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  await prisma.schoolMembership.create({ data: { userId: multiUser.id, schoolId: otherSchool.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  // Staff at BOTH schools. Required because listEvidence is the probe below and
  // 'teacher' holds an 'own' grant on it: without a personnel profile at the
  // resolved school there is no owner to scope to, and the operation now denies
  // with PERM-001 (2026-07-18 audit — it previously returned an UNFILTERED list,
  // which made this assertion pass for the wrong reason and only looked correct
  // because otherSchool happens to hold no evidence). Keeping the probe honest:
  // a 200 here must mean "the header resolved the school", not "the owner filter
  // silently vanished". See tests/security/own-scope-null-personnel.test.mjs.
  for (const schoolId of [school.id, otherSchool.id]) {
    await prisma.personnelProfile.create({
      data: { schoolId, userId: multiUser.id, fullName: 'Multi', positionRole: 'teacher', rankLevelCode: 'perm_kru' },
    });
  }
  const multiLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: multiUser.email, password: multiPassword } });
  const multiToken = multiLogin.json().access_token;

  const thirdSchool = await prisma.school.create({ data: { code: `perm-third-${randomUUID()}`, name: 'Third' } });
  const rejected = await app.inject({
    method: 'GET', url: '/api/v1/evidence',
    headers: { authorization: `Bearer ${multiToken}`, 'x-school-id': thirdSchool.id },
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.json().code, 'PERM-002');

  // ...but a header naming one of their ACTUAL memberships is honored.
  const accepted = await app.inject({
    method: 'GET', url: '/api/v1/evidence',
    headers: { authorization: `Bearer ${multiToken}`, 'x-school-id': otherSchool.id },
  });
  assert.equal(accepted.statusCode, 200);
});
