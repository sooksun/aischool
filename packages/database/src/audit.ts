// Append-only audit writes (AuditEvent — DB-enforced immutable via trigger,
// SEIP-DB-001). SEC-PDPA-2 requires before/after snapshots to use a field
// ALLOWLIST so learner content (evidence descriptions, file names, comments)
// never gets duplicated into the audit trail. That allowlist is enforced HERE,
// structurally — a caller can pass a full entity object and this module strips
// it down, rather than trusting every call site to remember to.
import type { Prisma } from '@prisma/client';
import { prisma } from './client.js';

type Primitive = string | number | boolean | null;
type Snapshot = Record<string, Primitive>;

/** Per-entity-type allowlist. Anything not listed here is silently dropped from
 * before/after, even if the caller passed it — the deny-by-default direction
 * that matches how permissions.yaml treats access. */
const AUDIT_ALLOWLIST: Record<string, readonly string[]> = {
  Evidence: ['id', 'schoolId', 'ownerPersonnelId', 'categoryId', 'status'], // title/description excluded: may contain learner-identifying text
  EvidenceFile: ['id', 'evidenceId', 'scanStatus', 'contentType'], // storageUri/checksum excluded: not useful for audit review, unnecessary exposure
  EvidenceIndicatorMapping: ['id', 'evidenceId', 'indicatorId', 'status', 'mappingSource'],
  Report: ['id', 'schoolId', 'cycleId', 'subjectPersonnelId', 'templateCode', 'status'],
  UserAccount: ['id', 'status'], // email/displayName excluded: direct PII
  SchoolMembership: ['id', 'userId', 'schoolId', 'role', 'status'],
  // CCR-014. fullName and employeeCode excluded: both directly identify a person,
  // same reason UserAccount omits email/displayName above. Who was onboarded is
  // answerable from userId without copying their name into the audit trail.
  PersonnelProfile: ['id', 'schoolId', 'userId', 'positionRole', 'rankLevelCode', 'status'],
  // CCR-015. Submit and acknowledge are the governance acts on a PA1, so they
  // must leave a trail — but the challenge text itself is excluded: title,
  // methodPlan and the targets are the evaluatee's own words about their
  // teaching, which is exactly the learner-adjacent free text SEC-PDPA-2 keeps
  // out of the audit log (same reason Evidence omits title/description above).
  // Who submitted what, and when, is answerable from id + status + personnelId.
  PerformanceAgreement: ['id', 'schoolId', 'cycleId', 'personnelId', 'status'],
};

function allowlist(entityType: string, obj: Record<string, unknown> | undefined): Snapshot | undefined {
  if (!obj) return undefined;
  const allowed = AUDIT_ALLOWLIST[entityType];
  if (!allowed) return undefined; // unknown entity type: fail closed, log nothing rather than leak
  const out: Snapshot = {};
  for (const key of allowed) {
    const v = obj[key];
    if (v === undefined) continue;
    out[key] = (v instanceof Date ? v.toISOString() : v) as Primitive;
  }
  return out;
}

export interface AuditWrite {
  schoolId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requestId?: string;
}

/**
 * `tx` lets a caller enrol the audit row in a surrounding transaction, matching
 * enqueueWorkerJob's convention. Worth doing wherever the audited write is
 * itself transactional: rolling back should un-say "this happened", and a
 * committed change with no trail is a compliance gap on an append-only log.
 */
export async function writeAuditEvent(
  w: AuditWrite,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      schoolId: w.schoolId,
      actorUserId: w.actorUserId,
      action: w.action,
      entityType: w.entityType,
      entityId: w.entityId,
      beforeState: allowlist(w.entityType, w.before) ?? undefined,
      afterState: allowlist(w.entityType, w.after) ?? undefined,
      requestId: w.requestId,
    },
  });
}
