/**
 * UI capability flags derived once from CurrentUser.memberships.
 *
 * Source of truth for *who may do what* remains docs/contracts/permissions.yaml
 * (API enforces). This map only drives nav / route affordances so App.tsx does
 * not grow ad-hoc role arrays. Keep each entry's comment = matrix operationId(s).
 */
import type { components } from '../api/schema.generated';

type Role = components['schemas']['Role'];
type Membership = components['schemas']['CurrentUser']['memberships'][number];

/** Named UI affordances — not 1:1 with every operationId, but each ties to matrix ops. */
export type UiCapability =
  /** createCycle / createRound / createAssignment / updateCycle / updateRound */
  | 'manageCycles'
  /** submitMyScores (evaluator + director as committee) */
  | 'scoreAsCommittee'
  /** listReports / getReport / getReportPdf */
  | 'viewReports'
  /** createReport */
  | 'createReports'
  /** actOnMapping school-level confirm/reject (not teacher own-revoke) */
  | 'governMappings'
  /** createEvidence / initiateFileUpload / completeFileUpload */
  | 'submitEvidence';

export type Capabilities = Record<UiCapability, boolean>;

/**
 * Roles that receive a non-deny grant for the cited operation(s) in permissions.yaml.
 * When the matrix changes, update here (and the unit test) in the same PR.
 */
export const CAPABILITY_ROLES: Record<UiCapability, readonly Role[]> = {
  // createCycle, createRound, createAssignment, updateCycle, updateRound
  manageCycles: ['director', 'school_admin'],
  // submitMyScores
  scoreAsCommittee: ['evaluator', 'director'],
  // listReports, getReport, getReportPdf
  viewReports: ['teacher', 'deputy', 'director', 'school_admin', 'evaluator', 'area_admin'],
  // createReport
  createReports: ['director', 'school_admin'],
  // actOnMapping: director + school_admin (school scope)
  governMappings: ['director', 'school_admin'],
  // createEvidence, initiateFileUpload, completeFileUpload — every role that owns
  // evidence. evaluator and area_admin are absent from the matrix row: they read
  // others' evidence (committee / area-r) but never submit their own.
  submitEvidence: ['teacher', 'deputy', 'director', 'school_admin'],
};

const FALSE_CAPS: Capabilities = {
  manageCycles: false,
  scoreAsCommittee: false,
  viewReports: false,
  createReports: false,
  governMappings: false,
  submitEvidence: false,
};

/** Pure: memberships → flags. Call once per user change (memoize in useAuth). */
export function capabilitiesFromMemberships(
  memberships: readonly Membership[] | null | undefined,
): Capabilities {
  if (!memberships?.length) return { ...FALSE_CAPS };

  const held = new Set<Role>();
  for (const m of memberships) held.add(m.role);

  const out = { ...FALSE_CAPS };
  for (const cap of Object.keys(CAPABILITY_ROLES) as UiCapability[]) {
    out[cap] = CAPABILITY_ROLES[cap].some((r) => held.has(r));
  }
  return out;
}

export function hasCapability(caps: Capabilities, flag: UiCapability): boolean {
  return caps[flag];
}
