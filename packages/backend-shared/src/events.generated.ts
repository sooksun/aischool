// GENERATED FILE — do not edit by hand.
// Source of truth: docs/contracts/events.yaml (version pinned below).
// Regenerate: npm run codegen:contracts
// Drift check: npm run gate:contracts (fails CI if this file disagrees with the source)

export const EVENTS_VERSION = '1.0.0';

export type EventType =
  | 'evidence.created'
  | 'evidence.file.registered'
  | 'evidence.file.scan_completed'
  | 'evidence.mapping.suggested'
  | 'evidence.mapping.confirmed'
  | 'evidence.mapping.rejected'
  | 'evidence.mapping.revoked'
  | 'assignment.created'
  | 'assignment.scores.submitted'
  | 'assignment.completed'
  | 'round.closed';

export interface Event_evidence_created {
  evidence_id: string;
  owner_personnel_id: string;
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
  scan_status: 'clean' | 'blocked';
}

export interface Event_evidence_mapping_suggested {
  mapping_id: string;
  evidence_id: string;
  indicator_id: string;
  mapping_source: 'human' | 'ai_suggested';
}

export interface Event_evidence_mapping_confirmed {
  mapping_id: string;
  evidence_id: string;
  indicator_id: string;
  confirmed_by_user_id: string;
}

export interface Event_evidence_mapping_rejected {
  mapping_id: string;
  evidence_id: string;
  indicator_id: string;
  rationale: string | null;
}

export interface Event_evidence_mapping_revoked {
  mapping_id: string;
  evidence_id: string;
  indicator_id: string;
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

export interface EventPayloadMap {
  'evidence.created': Event_evidence_created;
  'evidence.file.registered': Event_evidence_file_registered;
  'evidence.file.scan_completed': Event_evidence_file_scan_completed;
  'evidence.mapping.suggested': Event_evidence_mapping_suggested;
  'evidence.mapping.confirmed': Event_evidence_mapping_confirmed;
  'evidence.mapping.rejected': Event_evidence_mapping_rejected;
  'evidence.mapping.revoked': Event_evidence_mapping_revoked;
  'assignment.created': Event_assignment_created;
  'assignment.scores.submitted': Event_assignment_scores_submitted;
  'assignment.completed': Event_assignment_completed;
  'round.closed': Event_round_closed;
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
