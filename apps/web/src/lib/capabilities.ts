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
  /** actOnMapping validate / return (not the owner's own-revoke) */
  | 'governMappings'
  /** createEvidence / createUpload / completeUpload */
  | 'submitEvidence'
  /** listMembers / inviteMember / endMembership (CCR-014) */
  | 'manageMembers'
  /** listAreaSchools / createSchool / updateSchool / appointSchoolAdmin (CCR-021) */
  | 'manageAreaSchools'
  /** clearInjectionFlag (CCR-027) */
  | 'clearInjectionFlags'
  /** createSubjectRequest / listSubjectRequests (own) — FR-117, CCR-029 */
  | 'fileSubjectRequests'
  /** listSubjectRequests / decideSubjectRequest (dpo: area) */
  | 'handleSubjectRequests'
  /** listAreaDpos / appointDpo (CCR-029) */
  | 'appointDpos';

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
  // actOnMapping validate/return: director (school) + evaluator (committee).
  // school_admin manages members, not evidence judgements (permissions 2.0.0).
  governMappings: ['director', 'evaluator'],
  // createEvidence, createUpload, completeUpload — every role that owns
  // evidence. evaluator and area_admin are absent from the matrix row: they read
  // others' evidence (committee / area-r) but never submit their own.
  submitEvidence: ['teacher', 'deputy', 'director', 'school_admin'],
  // listMembers, inviteMember, endMembership — school_admin alone. Deliberately
  // NOT director: onboarding creates accounts and grants access to PDPA-scoped
  // evidence, which CCR-014 kept to the one role whose contract description is
  // "ผู้ดูแลระบบระดับโรงเรียน ... จัดการ ... บุคลากร".
  manageMembers: ['school_admin'],
  // listAreaSchools, createSchool, updateSchool, appointSchoolAdmin — the only
  // writes an area-scoped role holds (permissions.yaml area_admin_writes).
  manageAreaSchools: ['area_admin'],
  // clearInjectionFlag (CCR-027): school_admin of the item's school, never the owner.
  clearInjectionFlags: ['school_admin'],
  // createSubjectRequest (own): every role that is a person at a school.
  fileSubjectRequests: ['teacher', 'deputy', 'director', 'school_admin', 'evaluator'],
  // decideSubjectRequest (dpo: area) — the DPO alone; not area_admin (CCR-029).
  handleSubjectRequests: ['dpo'],
  // listAreaDpos / appointDpo — area_admin_writes (CCR-029).
  appointDpos: ['area_admin'],
};

const FALSE_CAPS: Capabilities = {
  manageCycles: false,
  scoreAsCommittee: false,
  viewReports: false,
  createReports: false,
  governMappings: false,
  submitEvidence: false,
  manageMembers: false,
  manageAreaSchools: false,
  clearInjectionFlags: false,
  fileSubjectRequests: false,
  handleSubjectRequests: false,
  appointDpos: false,
};

/**
 * Affordances whose API routes exist only when FEATURE_SCORING=true (ADR-0017:
 * v2 committee scoring + PA reports). With the flag off the server does not
 * register submitMyScores / getAssignmentResults / the report ops, so the
 * screens would be dead ends.
 */
export const V2_SCORING_CAPABILITIES: readonly UiCapability[] = ['scoreAsCommittee', 'viewReports', 'createReports'];

/** Build-time switch, read from the same FEATURE_SCORING as the API (vite.config.ts). */
export const FEATURE_SCORING: boolean = import.meta.env.VITE_FEATURE_SCORING === true;

/**
 * Pure: memberships → flags. Call once per user change (memoize in useAuth).
 * `featureScoring` defaults to on so the role table can be tested on its own;
 * useAuth passes the build's FEATURE_SCORING.
 */
export function capabilitiesFromMemberships(
  memberships: readonly Membership[] | null | undefined,
  featureScoring = true,
): Capabilities {
  if (!memberships?.length) return { ...FALSE_CAPS };

  const held = new Set<Role>();
  for (const m of memberships) held.add(m.role);

  const out = { ...FALSE_CAPS };
  for (const cap of Object.keys(CAPABILITY_ROLES) as UiCapability[]) {
    out[cap] = CAPABILITY_ROLES[cap].some((r) => held.has(r));
  }
  if (!featureScoring) for (const cap of V2_SCORING_CAPABILITIES) out[cap] = false;
  return out;
}

export function hasCapability(caps: Capabilities, flag: UiCapability): boolean {
  return caps[flag];
}
