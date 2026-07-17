// Append-only audit writes (AuditEvent — DB-enforced immutable via trigger,
// SEIP-DB-001). SEC-PDPA-2 requires before/after snapshots to use a field
// ALLOWLIST so learner content (evidence descriptions, file names, comments)
// never gets duplicated into the audit trail. That allowlist is enforced HERE,
// structurally — a caller can pass a full entity object and this module strips
// it down, rather than trusting every call site to remember to.
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

export async function writeAuditEvent(w: AuditWrite): Promise<void> {
  await prisma.auditEvent.create({
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
