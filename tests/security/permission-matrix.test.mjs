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
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { createPrismaClient } from '../../prisma/client.mjs';
import { hash as argonHash } from '@node-rs/argon2';
import { grantFor, isExempt } from '@seip/backend-shared';
import { buildServer } from '../../apps/api/dist/server.js';
import { PHASE_GATED_OPERATIONS } from '../../apps/api/dist/routes/phase-gated.js';
import { cleanupSchools, trackSchools } from '../helpers/db-cleanup.mjs';

const created = trackSchools();

const prisma = createPrismaClient();
let app;
const ROLES = ['teacher', 'director', 'deputy', 'evaluator', 'school_admin', 'area_admin'];
const tokenFor = {};
const userIdFor = {};
let secondEvaluatorUserId;
let school, area, evidenceId, indicatorId, mappingId, frameworkId, categoryId, uploadId;
let cycleId, roundId, assignmentId, teacherPersonnelId, agreementId, analysisId, suggestionId;

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  area = await prisma.area.create({ data: { code: `perm-area-${randomUUID()}`, name: 'Area' } });
  school = created.add(await prisma.school.create({ data: { code: `perm-school-${randomUUID()}`, name: 'School', areaId: area.id } }));
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
      data: { person: { create: { displayName: 'fixture' } }, email: `perm-${role}-${randomUUID()}@x.io`, displayName: role, status: 'active', passwordHash: await argonHash(password) },
    });
    if (role === 'area_admin') {
      // Area-scoped: schoolId is NULL by design (permissions.yaml scope: area),
      // so school-scoped teardown can neither see this membership nor the user
      // holding it. Tracked explicitly, like every other deliberately
      // school-less fixture.
      created.addUser(user);
      await prisma.schoolMembership.create({ data: { userId: user.id, areaId: area.id, role, membershipScope: 'area', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
    } else {
      await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
      if (role !== 'school_admin' && role !== 'evaluator') {
        await prisma.personnelProfile.create({ data: { schoolId: school.id, userId: user.id, personId: user.personId, fullName: role, positionRole: 'teacher', rankLevelCode: 'perm_kru' } });
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
    data: { person: { create: { displayName: 'fixture' } }, email: `perm-evaluator2-${randomUUID()}@x.io`, displayName: 'evaluator2', status: 'active', passwordHash: await argonHash('perm-test-evaluator2-password') },
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
  const create = await app.inject({ method: 'POST', url: '/api/v1/evidence', headers: { authorization: `Bearer ${tokenFor.teacher}`, 'idempotency-key': randomUUID() }, payload: evidenceBody(category.id, 'perm sweep evidence') });
  assert.equal(create.statusCode, 201, `setup: evidence fixture — ${create.body}`);
  evidenceId = create.json().id;

  // A real, open upload session on the teacher's evidence, so the upload ops
  // reach the ownership check instead of 404ing on a random id.
  const upload = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers: { authorization: `Bearer ${tokenFor.teacher}`, 'idempotency-key': randomUUID() }, payload: uploadBody() });
  assert.equal(upload.statusCode, 201, `setup: upload fixture — ${upload.body}`);
  uploadId = upload.json().id;

  const fw = created.addFramework(await prisma.frameworkVersion.upsert({
    where: { code: `perm-fw-${process.pid}` }, create: { code: `perm-fw-${process.pid}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() }, update: {},
  }));
  frameworkId = fw.id;
  const domain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: `D-${randomUUID()}`, nameTh: 'd', sortOrder: 1, part: 'standards' } });
  const indicator = await prisma.indicator.create({ data: { domainId: domain.id, frameworkVersionId: fw.id, code: `I-${randomUUID()}`, nameTh: 'i', sortOrder: 1, isScored: true, indicatorKind: 'standard' } });
  indicatorId = indicator.id;

  // P3: an analysis and an open suggestion on the teacher's evidence, so the
  // suggestion ops reach their ownership check on a real row.
  const analysis = await prisma.evidenceAnalysis.create({ data: { evidenceId, status: 'degraded', finishedAt: new Date() } });
  analysisId = analysis.id;
  const mapping = await app.inject({ method: 'POST', url: `/api/v1/evidence/${evidenceId}/mappings`, headers: { authorization: `Bearer ${tokenFor.teacher}`, 'idempotency-key': randomUUID() }, payload: { indicator_id: indicatorId } });
  assert.equal(mapping.statusCode, 201, `setup: mapping fixture — ${mapping.body}`);
  mappingId = mapping.json().id;
  suggestionId = (await prisma.aiSuggestion.create({
    data: { evidenceId, analysisId, indicatorId, frameworkVersionId: fw.id, band: 'possible', locators: [] },
  })).id;

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

  // A REAL agreement owned by OWNER_ROLE (teacher), created through the API like
  // the evidence fixture above. A random id would 404 before the ownership check
  // ever ran, so the sweep would be asserting nothing about `own` on these
  // operations — which is exactly what it did on the first run of this change.
  //
  // Via the API rather than Prisma on purpose: CCR-015's whole point is that the
  // product can create these now, and a fixture that quietly went around the
  // operations would reintroduce the shortcut that hid SEIP-BLOCK-002.
  const agreementRes = await app.inject({
    method: 'POST', url: '/api/v1/agreements',
    headers: { authorization: `Bearer ${tokenFor.teacher}`, 'x-school-id': school.id },
    // No challenge: this fixture's framework is synthetic and carries only a
    // `standard` indicator, so there is no C.1 to anchor one against. The sweep
    // does not need one — it needs a real agreement row to test ownership
    // against. A granted owner therefore gets AGR-002 on submitAgreement rather
    // than 200, which the sweep treats as an acceptable non-permission failure
    // (same philosophy as createMapping's expected VAL-002).
    payload: { cycle_id: cycle.id, personnel_id: teacherPersonnel.id },
  });
  assert.equal(agreementRes.statusCode, 201, `setup: agreement fixture — ${agreementRes.body}`);
  agreementId = agreementRes.json().id;
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

function evidenceBody(categoryId, title) {
  return { category_id: categoryId, title, kind: 'file', contains_learners: 'unknown', client_uuid: randomUUID() };
}
function uploadBody() {
  return { evidence_id: evidenceId, filename: 'x.pdf', content_type: 'application/pdf', byte_size: 10, checksum_sha256: 'a'.repeat(64) };
}

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
  // CCR-019: a dry run, so a granted role gets 200 and nothing is written.
  // CCR-021: the area admin's own area and school. Payloads that cannot change
  // the shared fixture (a no-op rename; invalid bodies for the creates).
  updatePersonnel: { method: 'PATCH', urlFor: async () => `/api/v1/personnel/${randomUUID()}`, payload: { full_name: 'x' } },
  issuePasswordReset: { method: 'POST', urlFor: async () => `/api/v1/members/${randomUUID()}/password-reset` },
  listAreaSchools: { method: 'GET', urlFor: async () => `/api/v1/areas/${area.id}/schools` },
  createSchool: { method: 'POST', urlFor: async () => `/api/v1/areas/${area.id}/schools`, payload: {} },
  updateSchool: { method: 'PATCH', urlFor: async () => `/api/v1/schools/${school.id}`, payload: { name: 'School' } },
  appointSchoolAdmin: { method: 'POST', urlFor: async () => `/api/v1/schools/${school.id}/admins`, payload: {} },
  importMembers: { method: 'POST', url: '/api/v1/members/import', payload: { dry_run: true, rows: [{ email: `sweep-import-${randomUUID()}@x.io`, display_name: 'sweep', role: 'teacher' }] } },
  // Random membership id → RES-001 for granted roles (never PERM-001), same
  // philosophy as getReport below.
  endMembership: { method: 'POST', url: `/api/v1/members/${randomUUID()}/end` },
  // acceptInvite is NOT swept: permissions.yaml lists it under `unauthenticated:`,
  // so it has no matrix row and no role dimension to sweep. Its security
  // properties — single-use, no-oracle AUTH-005, rate limiting — are covered
  // directly by apps/api/test/onboarding-flow.test.mjs.

  // agreements (CCR-015). A random agreement id yields RES-001 for granted
  // roles, never PERM-001 — same philosophy as getReport below. createAgreement
  // uses the fixture's real teacher personnel so a granted role fails at most on
  // AGR-001 (already exists), which is not a permission denial.
  listAgreements: { method: 'GET', url: '/api/v1/agreements' },
  getAgreement: { method: 'GET', url: `/api/v1/agreements/${agreementId}` },
  createAgreement: { method: 'POST', url: '/api/v1/agreements', payload: { cycle_id: cycleId, personnel_id: teacherPersonnelId } },
  updateAgreement: { method: 'PATCH', url: `/api/v1/agreements/${agreementId}`, payload: {} },
  submitAgreement: { method: 'POST', url: `/api/v1/agreements/${agreementId}/submit` },
  acknowledgeAgreement: { method: 'POST', url: `/api/v1/agreements/${randomUUID()}/acknowledge` },

  listFrameworks: { method: 'GET', url: '/api/v1/frameworks' },
  getFramework: { method: 'GET', url: `/api/v1/frameworks/${frameworkId}` },
  listEvidenceCategories: { method: 'GET', url: '/api/v1/evidence-categories' },
  listEvidence: { method: 'GET', url: '/api/v1/evidence' },
  // Random category → VAL-002 for granted roles, never PERM-001.
  createEvidence: { method: 'POST', url: '/api/v1/evidence', payload: evidenceBody(randomUUID(), 'x') },
  getEvidence: { method: 'GET', url: `/api/v1/evidence/${evidenceId}` },
  // No If-Match on purpose: authorization runs first, so a granted owner gets
  // 428 RES-005 (not a permission outcome) and the fixture is never mutated.
  updateEvidence: { method: 'PATCH', url: `/api/v1/evidence/${evidenceId}`, payload: { title: 'y' } },
  deleteEvidence: { method: 'DELETE', url: `/api/v1/evidence/${evidenceId}` },
  // Upload sessions (CCR-017). createUpload opens a fresh session per granted
  // owner; the rest act on the fixture session. abortUpload sorts last among
  // them.
  createUpload: { method: 'POST', url: '/api/v1/uploads', payload: uploadBody() },
  getUpload: { method: 'GET', url: `/api/v1/uploads/${uploadId}` },
  // single_put session → VAL-002 for a granted owner.
  signUploadParts: { method: 'POST', url: `/api/v1/uploads/${uploadId}/part-urls`, payload: { part_numbers: [1] } },
  // Nothing uploaded → UPL-008 for a granted owner (and the session stays open).
  completeUpload: { method: 'POST', url: `/api/v1/uploads/${uploadId}/complete`, payload: { part_count: 1 } },
  // A fresh teacher-owned session per role: the owner's abort ends the session,
  // and a later role must still meet a live one to prove ITS disposition.
  abortUpload: { method: 'DELETE', urlFor: async () => {
    const fresh = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers: { authorization: `Bearer ${tokenFor.teacher}`, 'idempotency-key': randomUUID() }, payload: uploadBody() });
    return `/api/v1/uploads/${fresh.json().id}`;
  } },
  // A random fileId yields RES-001 for granted roles, never PERM-001.
  getEvidenceFileDownloadUrl: { method: 'GET', url: `/api/v1/evidence/${evidenceId}/files/${randomUUID()}/download-url` },
  listEvidenceMappings: { method: 'GET', url: `/api/v1/evidence/${evidenceId}/mappings` },
  acceptEvidence: { method: 'POST', url: `/api/v1/evidence/${evidenceId}/accept` },
  // CCR-027: not flagged → a granted school admin gets the item back unchanged.
  clearInjectionFlag: { method: 'POST', url: `/api/v1/evidence/${evidenceId}/injection-flag/clear` },
  createMapping: { method: 'POST', url: `/api/v1/evidence/${evidenceId}/mappings`, payload: { indicator_id: randomUUID() } }, // random indicator: VAL-002 for granted roles, never PERM-001
  listMappings: { method: 'GET', url: '/api/v1/mappings' },

  // P3 analysis + suggestions. The owner's first re-run is accepted; later
  // granted calls meet the 10-minute throttle (AI-002) — not a permission
  // outcome. The fixture suggestion's indicator is already mapped, so the
  // owner's accept is MAP-001; reject uses a fresh suggestion per call.
  requestEvidenceAnalysis: { method: 'POST', url: `/api/v1/evidence/${evidenceId}/analysis` },
  getEvidenceAnalysis: { method: 'GET', url: `/api/v1/analyses/${analysisId}` },
  listEvidenceSegments: { method: 'GET', url: `/api/v1/evidence/${evidenceId}/segments` },
  listEvidenceSuggestions: { method: 'GET', url: `/api/v1/evidence/${evidenceId}/suggestions` },
  acceptSuggestion: { method: 'POST', url: `/api/v1/suggestions/${suggestionId}/accept` },
  acceptSuggestions: { method: 'POST', url: '/api/v1/suggestions/accept-batch', payload: { suggestion_ids: [randomUUID()] } },
  rejectSuggestion: { method: 'POST', urlFor: async () => {
    const s = await prisma.aiSuggestion.create({ data: { evidenceId, analysisId, indicatorId, frameworkVersionId: frameworkId, band: 'possible', locators: [], status: 'needs_review' } });
    return `/api/v1/suggestions/${s.id}/reject`;
  }, payload: { reason_code: 'not_relevant' } },
  // Role-conditional action: an own-revoke grant permits only revoke, and a
  // validator grant (school / committee) only validate / return. No If-Match, so
  // a granted caller stops at 428 RES-005 after authorization and the fixture
  // mapping is never changed.
  actOnMapping: { method: 'PATCH', url: `/api/v1/mappings/${mappingId}`, payloadFor: (grant) => ({ action: grant === 'own-revoke' ? 'revoke' : 'validate' }) },

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

  // approvals (CCR-016). Random report id → RES-001 for granted roles, never
  // PERM-001. approveReport/returnReport are NOT own-sensitive in this fixture's
  // sense: their `own`-style rule is the inverse ("you may NOT act on your own
  // report"), and it lives in the route rather than the matrix, so it is covered
  // directly by apps/api/test/report-approval.test.mjs instead.
  listReportApprovals: { method: 'GET', url: `/api/v1/reports/${randomUUID()}/approvals` },
  approveReport: { method: 'POST', url: `/api/v1/reports/${randomUUID()}/approve`, payload: {} },
  returnReport: { method: 'POST', url: `/api/v1/reports/${randomUUID()}/return`, payload: { comment: 'sweep' } },
});

// The fixture evidence/mapping above is owned by 'teacher', who is ALSO the
// fixture assignment's evaluatee (deliberately, so one OWNER_ROLE constant
// covers both). An 'own' or 'own-revoke' grant is necessary but not sufficient
// — the caller must also BE the owner/evaluatee. Operations below are
// 'own'-sensitive per permissions.yaml; for any role that holds one of these
// grants but isn't OWNER_ROLE, denial is the CORRECT outcome (proves the
// ownership boundary), not a matrix mismatch.
const OWNER_ROLE = 'teacher';
// Person-owned evidence (ADR-0015): a non-owner whose only route is an `own`
// grant has NO route to the item at all, and gets RES-001 — the same answer as a
// missing id, so the item's existence never leaks (apps/api/src/lib/evidence-access.ts).
const EVIDENCE_OWN_OPS = new Set([
  'getEvidence', 'updateEvidence', 'deleteEvidence', 'getEvidenceFileDownloadUrl',
  'createUpload', 'getUpload', 'signUploadParts', 'completeUpload', 'abortUpload',
  'listEvidenceMappings', 'createMapping', 'actOnMapping', 'acceptEvidence',
  'requestEvidenceAnalysis', 'getEvidenceAnalysis', 'listEvidenceSegments', 'listEvidenceSuggestions',
  'acceptSuggestion', 'rejectSuggestion',
]);
// School-owned resources keyed on personnel: a non-owner holding the `own` grant
// type is denied PERM-001 — the ownership boundary working, not a matrix gap.
const OWN_SENSITIVE_OPS = new Set([
  'getAssignment',
  // CCR-015. The evaluatee owns their ข้อตกลง: teacher/deputy/director all hold
  // `own` on these. createAgreement is deliberately included — a director filing
  // on a teacher's behalf is denied by design (the director acknowledges, they do
  // not author). listAgreements deliberately NOT: a list with an `own` grant
  // FILTERS rows rather than denying.
  'getAgreement', 'createAgreement', 'updateAgreement', 'submitAgreement',
]);

test('every implemented operation x every role matches its permissions.yaml disposition', async () => {
  const ops = OPERATIONS();
  const failures = [];
  let assertions = 0;
  // FR-095: request ids of every denial this sweep provokes; each must leave an
  // access_denied audit row naming the caller (checked after the loop).
  const denials = new Map();

  for (const [operationId, req] of Object.entries(ops)) {
    if (isExempt(operationId)) continue; // login/getCurrentUser not in this sweep — no per-role grant to check

    for (const role of ROLES) {
      const grant = grantFor(operationId, role);

      const res = await app.inject({
        method: req.method, url: req.urlFor ? await req.urlFor() : req.url,
        headers: { authorization: `Bearer ${tokenFor[role]}`, 'x-school-id': school.id, 'idempotency-key': randomUUID() },
        payload: req.payloadFor ? req.payloadFor(grant) : req.payload,
      });
      assertions++;

      // 204 No Content (e.g. a legitimate deleteEvidence by its actual owner) has
      // no body — light-my-request's .json() throws on empty input rather than
      // returning undefined, so guard on status the same way a real client would.
      const body = res.statusCode === 204 ? undefined : res.json();
      if (/^(PERM-\d{3}|RES-001|AUTH-006)$/.test(body?.code ?? '')) {
        denials.set(body.request_id, { operationId, role, code: body.code });
      }

      if (!grant) {
        // No grant at all: this role must never get past the permission check.
        if (res.statusCode !== 403 || body?.code !== 'PERM-001') {
          failures.push(`${operationId} x ${role}: expected 403 PERM-001 (no grant), got ${res.statusCode} ${body?.code ?? ''}`);
        }
      } else if ((grant === 'own' || grant === 'own-revoke') && EVIDENCE_OWN_OPS.has(operationId) && role !== OWNER_ROLE
        && !(role === 'evaluator' || role === 'director')) {
        // Own-type grant, not the owner, and no committee seat over the owner:
        // no route to the item at all.
        if (res.statusCode !== 404 || body?.code !== 'RES-001') {
          failures.push(`${operationId} x ${role}: has '${grant}' but isn't the owner — expected 404 RES-001, got ${res.statusCode} ${body?.code ?? ''}`);
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

  // Every SERVED matrix row is swept, except getAssignmentResults (temporal rule,
  // covered in scoring-flow). Phase-gated rows answer 501 to everyone and are
  // covered by the last test in this file. Derived from the matrix itself rather
  // than a hand-kept count — a sweep that silently covers less than the matrix is
  // how completeFileUpload and getEvidenceFileDownloadUrl once went unswept.
  const matrixOps = Object.keys(yaml.load(readFileSync(new URL('../../docs/contracts/permissions.yaml', import.meta.url), 'utf8')).matrix);
  const unswept = matrixOps.filter((op) => !(op in ops) && !PHASE_GATED_OPERATIONS.includes(op) && op !== 'getAssignmentResults');
  assert.deepEqual(unswept, [], `matrix rows with no sweep entry: ${unswept.join(', ')}`);
  assert.equal(assertions, Object.keys(ops).length * ROLES.length);
  assert.deepEqual(failures, [], `${failures.length} mismatch(es) between permissions.yaml and enforcement:\n${failures.join('\n')}`);

  // permissions.yaml notes: "Every deny path emits an AuditEvent with
  // action=access_denied when the request carried a valid identity."
  assert.ok(denials.size > 50, `the sweep should provoke plenty of denials (got ${denials.size})`);
  const rows = await prisma.auditEvent.findMany({
    where: { action: 'access_denied', requestId: { in: [...denials.keys()] } },
    select: { requestId: true, actorUserId: true, entityId: true, afterState: true },
  });
  const byRequest = new Map(rows.map((r) => [r.requestId, r]));
  const missing = [];
  for (const [requestId, d] of denials) {
    const row = byRequest.get(requestId);
    if (!row) { missing.push(`${d.operationId} x ${d.role} (${d.code})`); continue; }
    assert.equal(row.actorUserId, userIdFor[d.role], `${d.operationId} x ${d.role}: audited actor`);
    assert.equal(row.entityId, d.operationId);
    assert.equal(row.afterState.code, d.code);
  }
  assert.deepEqual(missing, [], `denials with no access_denied audit row:\n${missing.join('\n')}`);
});

test('area_admin is read-only: every write operation denies it even where director/school_admin are granted', async () => {
  const writeOps = ['createEvidence', 'updateEvidence', 'deleteEvidence', 'createUpload', 'completeUpload', 'createMapping', 'actOnMapping'];
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
  const otherSchool = created.add(await prisma.school.create({ data: { code: `perm-other-${randomUUID()}`, name: 'Other' } }));

  // Single-membership user: per CCR-003, the header is IGNORED (not validated) —
  // the request proceeds under the caller's own real school. A bogus header must
  // NOT leak into otherSchool's data; it must simply have no effect.
  const ignored = await app.inject({
    method: 'GET', url: '/api/v1/evidence',
    headers: { authorization: `Bearer ${tokenFor.teacher}`, 'x-school-id': otherSchool.id },
  });
  assert.equal(ignored.statusCode, 200);
  assert.ok(ignored.json().items.every((i) => i.origin_school_id === school.id), "must resolve to the caller's real school, not the header");

  // Multi-membership user: NOW the header is load-bearing, and a value that
  // matches neither membership must be rejected outright.
  const multiPassword = 'multi-school-password-1234';
  const multiUser = await prisma.userAccount.create({ data: { person: { create: { displayName: 'fixture' } }, email: `perm-multi-${randomUUID()}@x.io`, displayName: 'Multi', status: 'active', passwordHash: await argonHash(multiPassword) } });
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
      data: { schoolId, userId: multiUser.id, personId: multiUser.personId, fullName: 'Multi', positionRole: 'teacher', rankLevelCode: 'perm_kru' },
    });
  }
  const multiLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: multiUser.email, password: multiPassword } });
  const multiToken = multiLogin.json().access_token;

  const thirdSchool = created.add(await prisma.school.create({ data: { code: `perm-third-${randomUUID()}`, name: 'Third' } }));
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

test('every phase-gated operation answers 501 SYS-003 to an authenticated caller (CCR-017)', async () => {
  const { PHASE_GATED_ROUTES } = await import('../../apps/api/dist/routes/phase-gated.js');
  assert.ok(PHASE_GATED_OPERATIONS.length >= 10);
  for (const [method, path, operationId] of PHASE_GATED_ROUTES) {
    const url = '/api/v1' + path.replace(/:[A-Za-z]+/g, randomUUID());
    const res = await app.inject({ method: method.toUpperCase(), url, headers: { authorization: `Bearer ${tokenFor.teacher}` }, payload: method === 'get' || method === 'delete' ? undefined : {} });
    assert.equal(res.statusCode, 501, `${operationId}: ${res.statusCode} ${res.body}`);
    assert.equal(res.json().code, 'SYS-003');
  }
});

test('a request with no valid identity leaves no access_denied row (nothing to attribute)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/evidence', headers: { authorization: 'Bearer not-a-token', 'x-school-id': school.id } });
  assert.equal(res.statusCode, 401);
  const rows = await prisma.auditEvent.count({ where: { requestId: res.json().request_id } });
  assert.equal(rows, 0);
});

test('taxonomy needs a role, not just a login: an account with no live membership gets PERM-001', async () => {
  const password = `nomember-${randomUUID()}`;
  const user = created.addUser(await prisma.userAccount.create({
    data: { person: { create: { displayName: 'no member' } }, email: `nomember-${randomUUID()}@x.io`, displayName: 'No member', status: 'active', passwordHash: await argonHash(password) },
  }));
  const token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token;
  for (const url of ['/api/v1/frameworks', `/api/v1/frameworks/${frameworkId}`, '/api/v1/evidence-categories']) {
    const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.statusCode, 403, `${url}: ${res.body}`);
    assert.equal(res.json().code, 'PERM-001');
  }
});

test('createCycle with an unknown framework is VAL-002, not a 500 from the foreign key', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/cycles',
    headers: { authorization: `Bearer ${tokenFor.director}`, 'x-school-id': school.id },
    payload: { framework_version_id: randomUUID(), fiscal_year: 9997, evaluation_kind: 'pa', title: 'x', starts_on: '2026-01-01', ends_on: '2026-12-31' },
  });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().code, 'VAL-002');
});
