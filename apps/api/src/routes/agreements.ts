// Performance agreements (แบบ PA1) and ประเด็นท้าทาย — CCR-015 / SEIP-BLOCK-002.
//
// Two things were broken before this file existed. Scoring was unreachable: no
// agreement meant no workload declaration meant SCORE-004, so submitMyScores
// could never succeed. And the committee scored indicators C.1/C.2.1/C.2.2 — 40%
// of a teacher's result — without ever seeing the method and targets those
// indicators rate, because nothing wrote or read AgreementChallenge.
//
// The document belongs to the evaluatee: they write it, they submit it, and they
// can never acknowledge it. `own` grants here go through requireOwnership, not
// just the role check — this is the record a career decision rests on.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listAgreements, getAgreement, createAgreement, upsertChallenge,
  transitionAgreement, findChallengeAnchorIndicator,
  getPersonnelById, getCycleDetail, getFrameworkById,
} from '@seip/database';
import { ApiError, forbiddenAreaWrite } from '@seip/backend-shared';
import { requireCurrentSchool } from '../plugins/auth.js';
import { resolveGrant, requireOwnership } from '../lib/permission-guard.js';
import { serializeAgreement, serializeAgreementDetail } from '../lib/serialize-agreement.js';

const ChallengeInput = z.object({
  title: z.string().min(1).max(500),
  method_plan: z.string().min(1).max(5000),
  quantitative_target: z.string().max(5000).nullish(),
  qualitative_target: z.string().max(5000).nullish(),
  target_group: z.string().max(500).nullish(),
  period_note: z.string().max(500).nullish(),
});

function toChallengeInput(c: z.infer<typeof ChallengeInput>) {
  return {
    title: c.title,
    methodPlan: c.method_plan,
    quantitativeTarget: c.quantitative_target ?? null,
    qualitativeTarget: c.qualitative_target ?? null,
    targetGroup: c.target_group ?? null,
    periodNote: c.period_note ?? null,
  };
}

/** ว9 teachers file PA1/ส, ว10 administrators file PA1/บส. Derived from the
 * personnel's position_role rather than accepted from the client — the form
 * variant is a fact about the person, not a preference. */
function formVariantFor(positionRole: string): string {
  return positionRole === 'administrator' ? 'PA1_bs' : 'PA1_s';
}

export const agreementRoutes: FastifyPluginAsync = async (app) => {
  app.get('/agreements', { config: { operationId: 'listAgreements' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('listAgreements', auth, schoolId);

    const q = z.object({
      cycle_id: z.string().uuid().optional(),
      status: z.enum(['draft', 'submitted', 'acknowledged']).optional(),
    }).parse(request.query);

    // Row filtering by grant, the same shape listEvidence uses. An 'own' caller
    // with no personnel profile must DENY, not widen to the whole school — the
    // exact regression tests/security/own-scope-null-personnel.test.mjs exists
    // for (Prisma drops an `undefined` filter entirely).
    let personnelId: string | undefined;
    let committeeEvaluatorUserId: string | undefined;
    if (grant === 'own') {
      if (!auth.personnel) throw new ApiError('VAL-002', 'No personnel profile at this school');
      personnelId = auth.personnel.id;
    } else if (grant === 'committee') {
      committeeEvaluatorUserId = auth.userId;
    }

    const rows = await listAgreements(schoolId, {
      cycleId: q.cycle_id, status: q.status, personnelId, committeeEvaluatorUserId,
    });
    return rows.map(serializeAgreement);
  });

  app.get('/agreements/:agreementId', { config: { operationId: 'getAgreement' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { agreementId } = z.object({ agreementId: z.string().uuid() }).parse(request.params);

    const agreement = await getAgreement(schoolId, agreementId);
    if (!agreement) throw new ApiError('RES-001', 'Agreement not found');
    const grant = await resolveGrant('getAgreement', auth, agreement.schoolId);
    if (grant === 'own') requireOwnership(auth, agreement.personnelId);
    if (grant === 'committee') {
      // Reuse the list query's own committee filter rather than re-deriving the
      // relation here, so read access can't drift between list and detail.
      const visible = await listAgreements(schoolId, { committeeEvaluatorUserId: auth.userId });
      if (!visible.some((a) => a.id === agreementId)) {
        throw new ApiError('PERM-003', 'Not a committee member for this evaluatee');
      }
    }
    return serializeAgreementDetail(agreement);
  });

  app.post('/agreements', { config: { operationId: 'createAgreement' } }, async (request, reply) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('createAgreement', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const body = z.object({
      cycle_id: z.string().uuid(),
      personnel_id: z.string().uuid(),
      challenge: ChallengeInput.optional(),
    }).parse(request.body);

    if (grant === 'own') requireOwnership(auth, body.personnel_id);

    // Both FKs validated for existence AND school before use — the audit found
    // four fields already trusting client-supplied ids, and this one binds a
    // person to the evaluation their career rests on.
    const personnel = await getPersonnelById(body.personnel_id);
    if (!personnel || personnel.schoolId !== schoolId) {
      throw new ApiError('VAL-002', 'Unknown personnel_id');
    }
    const cycle = await getCycleDetail(schoolId, body.cycle_id);
    if (!cycle) throw new ApiError('VAL-002', 'Unknown cycle_id');

    const framework = await getFrameworkById(cycle.frameworkVersionId);
    if (!framework) throw new ApiError('SYS-001', "cycle's framework vanished");
    // A ว9 teacher cannot file against a ว10 cycle: the challenge would be
    // anchored to the wrong framework's indicator and scored on the wrong rubric.
    if (personnel.positionRole !== framework.roleFamily) {
      throw new ApiError('VAL-003', "personnel's position role does not match this cycle's framework");
    }

    let challengeIndicatorId: string | undefined;
    if (body.challenge) {
      const anchor = await findChallengeAnchorIndicator(cycle.frameworkVersionId);
      if (!anchor) throw new ApiError('SYS-001', 'framework has no challenge indicator to anchor against');
      challengeIndicatorId = anchor.id;
    }

    const created = await createAgreement({
      schoolId,
      cycleId: body.cycle_id,
      personnelId: body.personnel_id,
      formVariant: formVariantFor(personnel.positionRole),
      challenge: body.challenge && toChallengeInput(body.challenge),
      challengeIndicatorId,
      actorUserId: auth.userId,
      requestId: request.id,
    });
    if (!created.ok) {
      throw new ApiError('AGR-001', 'An agreement already exists for this cycle and person');
    }

    const detail = await getAgreement(schoolId, created.id);
    reply.status(201).send(serializeAgreementDetail(detail!));
  });

  app.patch('/agreements/:agreementId', { config: { operationId: 'updateAgreement' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('updateAgreement', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const { agreementId } = z.object({ agreementId: z.string().uuid() }).parse(request.params);
    const body = z.object({ challenge: ChallengeInput.optional() }).parse(request.body);

    const agreement = await getAgreement(schoolId, agreementId);
    if (!agreement) throw new ApiError('RES-001', 'Agreement not found');
    if (grant === 'own') requireOwnership(auth, agreement.personnelId);

    // The freeze. Editing a submitted agreement would let an evaluatee rewrite
    // the targets they are about to be scored against; editing an acknowledged
    // one would rewrite what the director signed.
    if (agreement.status !== 'draft') {
      throw new ApiError('AGR-002', 'Only a draft agreement can be edited');
    }

    if (body.challenge) {
      const cycle = await getCycleDetail(schoolId, agreement.cycleId);
      if (!cycle) throw new ApiError('SYS-001', "agreement's cycle vanished");
      const anchor = await findChallengeAnchorIndicator(cycle.frameworkVersionId);
      if (!anchor) throw new ApiError('SYS-001', 'framework has no challenge indicator to anchor against');
      await upsertChallenge(agreementId, anchor.id, toChallengeInput(body.challenge));
    }

    const updated = await getAgreement(schoolId, agreementId);
    return serializeAgreementDetail(updated!);
  });

  app.post('/agreements/:agreementId/submit', { config: { operationId: 'submitAgreement' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('submitAgreement', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const { agreementId } = z.object({ agreementId: z.string().uuid() }).parse(request.params);
    const agreement = await getAgreement(schoolId, agreementId);
    if (!agreement) throw new ApiError('RES-001', 'Agreement not found');
    if (grant === 'own') requireOwnership(auth, agreement.personnelId);

    // Submitting without a challenge would hand the committee an empty 40% to
    // score — the precise defect contract v3.0 exists to close, so it is refused
    // here rather than surfacing later as blank fields on a scoring screen.
    if (agreement.challenges.length === 0) {
      throw new ApiError('AGR-002', 'Cannot submit an agreement with no ประเด็นท้าทาย');
    }

    const ok = await transitionAgreement(schoolId, agreementId, 'draft', 'submitted', auth.userId, request.id);
    if (!ok) throw new ApiError('AGR-002', 'Only a draft agreement can be submitted');

    const updated = await getAgreement(schoolId, agreementId);
    return serializeAgreementDetail(updated!);
  });

  app.post('/agreements/:agreementId/acknowledge', { config: { operationId: 'acknowledgeAgreement' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('acknowledgeAgreement', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const { agreementId } = z.object({ agreementId: z.string().uuid() }).parse(request.params);
    const agreement = await getAgreement(schoolId, agreementId);
    if (!agreement) throw new ApiError('RES-001', 'Agreement not found');

    // A director is an evaluatee too under ว10, so the matrix alone cannot
    // express this — acknowledging is a signature on SOMEONE ELSE'S commitments,
    // and self-signing is not one. Enforced here because permissions.yaml has no
    // vocabulary for "any grant except over yourself".
    if (auth.personnel && auth.personnel.id === agreement.personnelId) {
      throw new ApiError('AGR-002', 'You cannot acknowledge your own agreement — another director or the school admin must');
    }

    const ok = await transitionAgreement(schoolId, agreementId, 'submitted', 'acknowledged', auth.userId, request.id);
    if (!ok) throw new ApiError('AGR-002', 'Only a submitted agreement can be acknowledged');

    const updated = await getAgreement(schoolId, agreementId);
    return serializeAgreementDetail(updated!);
  });
};
