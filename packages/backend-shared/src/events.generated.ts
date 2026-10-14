// GENERATED FILE — do not edit by hand.
// Source of truth: docs/contracts/events.yaml (version pinned below).
// Regenerate: npm run codegen:contracts
// Drift check: npm run gate:contracts (fails CI if this file disagrees with the source)

export const EVENTS_VERSION = '2.2.0';

export type EventType =
  | 'evidence.created'
  | 'evidence.file.registered'
  | 'evidence.file.scan_completed'
  | 'evidence.file.verified'
  | 'analysis.completed'
  | 'analysis.failed'
  | 'mapping.owner_confirmed'
  | 'mapping.validated'
  | 'mapping.returned'
  | 'mapping.revoked'
  | 'export.ready'
  | 'assignment.created'
  | 'assignment.scores.submitted'
  | 'assignment.completed'
  | 'round.closed'
  | 'report.generated'
  | 'ai.suggestion.created'
  | 'assignment.comment.created'
  | 'report.approved';

export interface Event_evidence_created {
  evidence_id: string;
  owner_person_id: string;
  category_code: string;
}

export interface Event_evidence_file_registered {
  evidence_id: string;
  file_id: string;
  content_type: string;
  byte_size: number;
}

export interface Event_evidence_file_scan_completed {
  evidence_id: string;
  file_id: string;
  scan_status: 'clean' | 'unscanned' | 'blocked';
}

export interface Event_evidence_file_verified {
  evidence_id: string;
  file_id: string;
  sha256_matched: boolean;
}

export interface Event_analysis_completed {
  analysis_id: string;
  evidence_id: string;
  status: 'succeeded' | 'degraded';
  suggestion_count: number;
}

export interface Event_analysis_failed {
  analysis_id: string;
  evidence_id: string;
  error_code: string;
}

export interface Event_mapping_owner_confirmed {
  mapping_id: string;
  evidence_id: string;
  indicator_id: string;
  mapping_source: 'ai_accepted' | 'manual';
}

export interface Event_mapping_validated {
  mapping_id: string;
  evidence_id: string;
  indicator_id: string;
  validated_by_user_id: string;
  validator_role: 'director' | 'committee';
}

export interface Event_mapping_returned {
  mapping_id: string;
  evidence_id: string;
  indicator_id: string;
  validated_by_user_id: string;
}

export interface Event_mapping_revoked {
  mapping_id: string;
  evidence_id: string;
  indicator_id: string;
}

export interface Event_export_ready {
  export_id: string;
  kind: 'dpa_pack' | 'pa2_workbook' | 'portfolio_portable';
  person_id: string | null;
}

export interface Event_assignment_created {
  assignment_id: string;
  round_id: string;
  evaluatee_personnel_id: string;
  committee_user_ids: string[];
}

export interface Event_assignment_scores_submitted {
  assignment_id: string;
  evaluator_user_id: string;
  total_percent: number;
  passed_individual_threshold: boolean;
}

export interface Event_assignment_completed {
  assignment_id: string;
  overall_pass: boolean;
  workload_gate_met: boolean;
}

export interface Event_round_closed {
  round_id: string;
  cycle_id: string;
  assignment_count: number;
  completed_count: number;
}

export interface Event_report_generated {
  report_id: string;
  cycle_id: string;
  subject_personnel_id: string;
  template_code: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'issued' | 'superseded';
}

export interface Event_ai_suggestion_created {
  evidence_id: string;
  analysis_id: string;
  suggestion_count: number;
}

export interface Event_assignment_comment_created {
  assignment_id: string;
  comment_id: string;
  indicator_id: string;
  kind: 'comment' | 'request_info' | 'reply';
}

export interface Event_report_approved {
  report_id: string;
  cycle_id: string;
  subject_personnel_id: string;
  approver_user_id: string;
  step_code: string;
}

export interface EventPayloadMap {
  'evidence.created': Event_evidence_created;
  'evidence.file.registered': Event_evidence_file_registered;
  'evidence.file.scan_completed': Event_evidence_file_scan_completed;
  'evidence.file.verified': Event_evidence_file_verified;
  'analysis.completed': Event_analysis_completed;
  'analysis.failed': Event_analysis_failed;
  'mapping.owner_confirmed': Event_mapping_owner_confirmed;
  'mapping.validated': Event_mapping_validated;
  'mapping.returned': Event_mapping_returned;
  'mapping.revoked': Event_mapping_revoked;
  'export.ready': Event_export_ready;
  'assignment.created': Event_assignment_created;
  'assignment.scores.submitted': Event_assignment_scores_submitted;
  'assignment.completed': Event_assignment_completed;
  'round.closed': Event_round_closed;
  'report.generated': Event_report_generated;
  'ai.suggestion.created': Event_ai_suggestion_created;
  'assignment.comment.created': Event_assignment_comment_created;
  'report.approved': Event_report_approved;
}

/** Envelope fields required on every emitted event (events.yaml #envelope). */
export interface EventEnvelope<T extends EventType> {
  event_id: string;
  event_type: T;
  schema_version: number;
  occurred_at: string;
  school_id: string | null;
  actor_user_id: string | null;
  request_id?: string;
  payload: EventPayloadMap[T];
}
