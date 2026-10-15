// Shared between routes/agreements.ts and routes/scoring.ts — the scoring screen
// embeds the challenge in AssignmentDetail (CCR-015), so both must emit the
// identical shape. One function rather than two, because a drifting duplicate
// here would mean the committee sees a different rendering of the document than
// the person who wrote it.

export interface ChallengeRow {
  id: string;
  indicatorId: string;
  title: string;
  methodPlan: string;
  quantitativeTarget: string | null;
  qualitativeTarget: string | null;
  targetGroup: string | null;
  periodNote: string | null;
}

export function serializeChallenge(c: ChallengeRow | null | undefined) {
  if (!c) return null;
  return {
    id: c.id,
    indicator_id: c.indicatorId,
    title: c.title,
    method_plan: c.methodPlan,
    quantitative_target: c.quantitativeTarget,
    qualitative_target: c.qualitativeTarget,
    target_group: c.targetGroup,
    period_note: c.periodNote,
  };
}

export interface AgreementRow {
  id: string;
  schoolId: string;
  cycleId: string;
  personnelId: string;
  formVariant: string;
  status: string;
  submittedAt: Date | null;
  challenges?: ChallengeRow[];
}

export function serializeAgreement(a: AgreementRow) {
  return {
    id: a.id,
    school_id: a.schoolId,
    cycle_id: a.cycleId,
    personnel_id: a.personnelId,
    form_variant: a.formVariant,
    status: a.status,
    submitted_at: a.submittedAt ? a.submittedAt.toISOString() : null,
  };
}

export function serializeAgreementDetail(a: AgreementRow) {
  return {
    ...serializeAgreement(a),
    // The schema permits many challenge rows per agreement; CCR-015 decision 1
    // says the product files exactly one (the PA1 form has one ประเด็นท้าทาย).
    // Taking [0] rather than mapping is that decision expressed in code.
    challenge: serializeChallenge(a.challenges?.[0]),
  };
}
