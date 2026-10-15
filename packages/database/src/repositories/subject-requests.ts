// FR-117 data-subject requests (CCR-029). A person files about their own data;
// the DPO of the filing school's area decides. Approving access / portability
// queues the person's portfolio export and the request completes when that
// export is ready; any other type is carried out by hand and then completed.
import type { Prisma, SubjectRequestStatus, SubjectRequestType } from '@prisma/client';
import { prisma } from '../client.js';
import { writeAuditEvent } from '../audit.js';
import { enqueueOutboxEvent } from './outbox.js';
import { enqueueWorkerJob } from './jobs.js';
import { currentMembershipWhere } from './identity.js';

/** NFR-PDPA-05: 30 days from receipt (unverified, REG-28) — a warning, never a block. */
export const SUBJECT_REQUEST_RESPONSE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPORT_TYPES: ReadonlySet<SubjectRequestType> = new Set(['access', 'portability']);
const OPEN: SubjectRequestStatus[] = ['received', 'fulfilling', 'approved'];

export type SubjectRequestRow = Prisma.SubjectRequestGetPayload<object> & { requesterDisplayName: string };

async function withNames<T extends { personId: string }>(rows: T[]): Promise<(T & { requesterDisplayName: string })[]> {
  const ids = [...new Set(rows.map((r) => r.personId))];
  const people = ids.length ? await prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }) : [];
  const name = new Map(people.map((p) => [p.id, p.displayName]));
  return rows.map((r) => ({ ...r, requesterDisplayName: name.get(r.personId) ?? '' }));
}

export async function fileSubjectRequest(input: {
  personId: string; userId: string; schoolId: string; areaId: string;
  requestType: SubjectRequestType; details: string | null; requestId?: string;
}): Promise<SubjectRequestRow> {
  const row = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const r = await tx.subjectRequest.create({
      data: {
        personId: input.personId, requestedByUserId: input.userId, schoolId: input.schoolId, areaId: input.areaId,
        requestType: input.requestType, details: input.details, receivedAt: now,
        dueAt: new Date(now.getTime() + SUBJECT_REQUEST_RESPONSE_DAYS * DAY_MS),
      },
    });
    await enqueueOutboxEvent({
      eventType: 'subject_request.created', schoolId: input.schoolId, actorUserId: input.userId, requestId: input.requestId ?? null,
      payload: { request_id: r.id, area_id: r.areaId, request_type: r.requestType },
    }, tx);
    await writeAuditEvent({
      schoolId: input.schoolId, actorUserId: input.userId, action: 'subject_request_filed',
      entityType: 'SubjectRequest', entityId: r.id, after: r, requestId: input.requestId,
    }, tx);
    return r;
  });
  return (await withNames([row]))[0];
}

export async function getSubjectRequestById(id: string): Promise<SubjectRequestRow | null> {
  const r = await prisma.subjectRequest.findUnique({ where: { id } });
  return r ? (await withNames([r]))[0] : null;
}

/** The caller's own requests (personId) and/or every request of the given DPO areas. Open and soonest due first. */
export async function listSubjectRequestsFor(
  personId: string | null, areaIds: string[], f: { status?: SubjectRequestStatus; offset: number; limit: number },
) {
  const or: Prisma.SubjectRequestWhereInput[] = [];
  if (personId) or.push({ personId });
  if (areaIds.length) or.push({ areaId: { in: areaIds } });
  if (or.length === 0) return { items: [] as SubjectRequestRow[], more: false };
  const rows = await prisma.subjectRequest.findMany({
    where: { OR: or, ...(f.status ? { status: f.status } : {}) },
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    skip: f.offset, take: f.limit + 1,
  });
  return { items: await withNames(rows.slice(0, f.limit)), more: rows.length > f.limit };
}

export type DecideResult =
  | { ok: true; row: SubjectRequestRow }
  | { ok: false; reason: 'not_found' | 'bad_transition' | 'note_required' };

/**
 * approve: received → fulfilling (access/portability: the export is queued in the
 *          same transaction) or → approved (other types, carried out by hand).
 * reject:  received | approved → rejected, with a reason.
 * complete: approved → completed, with a note of what was done.
 * The status guard is part of the UPDATE, so two DPOs deciding at once cannot both win.
 */
export async function decideSubjectRequest(input: {
  id: string; action: 'approve' | 'reject' | 'complete'; note: string | null; actorUserId: string; requestId?: string;
}): Promise<DecideResult> {
  const note = input.note?.trim() || null;
  if ((input.action === 'reject' || input.action === 'complete') && !note) return { ok: false, reason: 'note_required' };
  const result = await prisma.$transaction(async (tx) => {
    const cur = await tx.subjectRequest.findUnique({ where: { id: input.id } });
    if (!cur) return { ok: false, reason: 'not_found' } as const;
    const now = new Date();
    let from: SubjectRequestStatus[];
    let data: Prisma.SubjectRequestUpdateManyMutationInput;
    let exportId: string | null = null;
    if (input.action === 'approve') {
      from = ['received'];
      if (EXPORT_TYPES.has(cur.requestType)) {
        const exp = await tx.exportPackage.create({
          data: { kind: 'portfolio_portable', personId: cur.personId, schoolId: cur.schoolId, requestedByUserId: input.actorUserId },
        });
        await enqueueWorkerJob({ jobType: 'export.build', payload: { export_id: exp.id } }, tx);
        exportId = exp.id;
        data = { status: 'fulfilling', exportId, decisionNote: note, decidedAt: now, decidedByUserId: input.actorUserId };
      } else {
        data = { status: 'approved', decisionNote: note, decidedAt: now, decidedByUserId: input.actorUserId };
      }
    } else if (input.action === 'reject') {
      from = ['received', 'approved'];
      data = { status: 'rejected', decisionNote: note, decidedAt: now, decidedByUserId: input.actorUserId };
    } else {
      from = ['approved'];
      data = { status: 'completed', decisionNote: note, completedAt: now };
    }
    const n = await tx.subjectRequest.updateMany({ where: { id: cur.id, status: { in: from } }, data });
    if (n.count === 0) {
      if (exportId) throw new Error('rollback'); // never leave an orphan export behind a lost race
      return { ok: false, reason: 'bad_transition' } as const;
    }
    const row = (await tx.subjectRequest.findUnique({ where: { id: cur.id } }))!;
    await enqueueOutboxEvent({
      eventType: 'subject_request.decided', schoolId: row.schoolId, actorUserId: input.actorUserId, requestId: input.requestId ?? null,
      payload: { request_id: row.id, status: row.status },
    }, tx);
    await writeAuditEvent({
      schoolId: row.schoolId, actorUserId: input.actorUserId, action: `subject_request_${input.action}`,
      entityType: 'SubjectRequest', entityId: row.id, before: cur, after: row, requestId: input.requestId,
    }, tx);
    return { ok: true, row } as const;
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === 'rollback') return { ok: false, reason: 'bad_transition' } as const;
    throw e;
  });
  if (!result.ok) return result;
  return { ok: true, row: (await withNames([result.row]))[0] };
}

/** Worker side (export.ready): an access / portability request completes when its export is ready. */
export async function completeSubjectRequestForExport(exportId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const r = await tx.subjectRequest.findUnique({ where: { exportId } });
    if (!r || r.status !== 'fulfilling') return false;
    const n = await tx.subjectRequest.updateMany({ where: { id: r.id, status: 'fulfilling' }, data: { status: 'completed', completedAt: new Date() } });
    if (n.count === 0) return false;
    await enqueueOutboxEvent({
      eventType: 'subject_request.decided', schoolId: r.schoolId, actorUserId: null,
      payload: { request_id: r.id, status: 'completed' },
    }, tx);
    await writeAuditEvent({
      schoolId: r.schoolId, actorUserId: null, action: 'subject_request_completed',
      entityType: 'SubjectRequest', entityId: r.id, before: r, after: { ...r, status: 'completed' },
    }, tx);
    return true;
  });
}

export { OPEN as OPEN_SUBJECT_REQUEST_STATUSES };

// ── DPO appointments (area-scoped memberships) ──

export async function listAreaDpos(areaId: string) {
  return prisma.schoolMembership.findMany({
    where: { areaId, role: 'dpo', membershipScope: 'area', ...currentMembershipWhere() },
    include: { user: { select: { id: true, email: true, displayName: true, status: true } } },
    orderBy: { effectiveFrom: 'asc' },
  });
}

/** Active accounts holding the dpo role over an area (notification recipients). */
export async function listAreaDpoUserIds(areaId: string): Promise<string[]> {
  const rows = await prisma.schoolMembership.findMany({
    where: { areaId, role: 'dpo', membershipScope: 'area', ...currentMembershipWhere(), user: { status: 'active' } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

export type AppointDpoResult =
  | { ok: true; membershipId: string; userId: string; issuedInvite: boolean }
  | { ok: false; reason: 'already_dpo' };

/**
 * Same rules as inviteMember (identity.ts): an account that already has a
 * password never receives an invite token, and the overlap check shares the
 * transaction with the write.
 */
export async function appointAreaDpo(input: {
  areaId: string; email: string; displayName: string; actorUserId: string;
  inviteTokenHash: string; inviteExpiresAt: Date; requestId?: string;
}): Promise<AppointDpoResult> {
  const email = input.email.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.userAccount.findUnique({ where: { email }, select: { id: true, passwordHash: true, status: true, personId: true } });
    if (existing) {
      const clash = await tx.schoolMembership.findFirst({
        where: { userId: existing.id, areaId: input.areaId, role: 'dpo', ...currentMembershipWhere() }, select: { id: true },
      });
      if (clash) return { ok: false, reason: 'already_dpo' } as const;
    }
    const issuedInvite = !existing?.passwordHash;
    const user = existing
      ? issuedInvite
        ? await tx.userAccount.update({
            where: { id: existing.id },
            data: { inviteTokenHash: input.inviteTokenHash, inviteExpiresAt: input.inviteExpiresAt },
            select: { id: true },
          })
        : { id: existing.id }
      : await tx.userAccount.create({
          data: {
            email, displayName: input.displayName, status: 'invited',
            inviteTokenHash: input.inviteTokenHash, inviteExpiresAt: input.inviteExpiresAt,
            person: { create: { displayName: input.displayName } },
          },
          select: { id: true },
        });
    const m = await tx.schoolMembership.create({
      data: { userId: user.id, areaId: input.areaId, role: 'dpo', membershipScope: 'area', effectiveFrom: today, status: 'active' },
      select: { id: true },
    });
    await writeAuditEvent({
      schoolId: null, actorUserId: input.actorUserId, action: 'membership_granted', entityType: 'SchoolMembership', entityId: m.id,
      after: { id: m.id, userId: user.id, areaId: input.areaId, role: 'dpo', status: 'active' }, requestId: input.requestId,
    }, tx);
    return { ok: true, membershipId: m.id, userId: user.id, issuedInvite } as const;
  });
}
