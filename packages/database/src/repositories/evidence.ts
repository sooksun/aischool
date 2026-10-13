// Evidence + EvidenceFile — a PERSON-OWNED portfolio (ADR-0015, CCR-017).
//
// Evidence used to be school-owned and every query folded a school id in. A
// portfolio item now belongs to a person and survives their transfer, so access
// is decided in the API layer from three sources — the caller IS the owner, holds
// a school grant at the item's ORIGIN school, or sits on a committee for the
// owner — and the queries here take whichever filter that decision produced.
// listEvidence refuses to run with no scope filter at all, so a missing filter can
// never widen into "everything".
import { randomUUID } from 'node:crypto';
import { prisma } from '../client.js';
import type {
  ContainsLearners, EvidenceKind, EvidenceStatus, PerformedDateSource, Prisma,
} from '@prisma/client';
import { enqueueOutboxEvent } from './outbox.js';
import { enqueueWorkerJob } from './jobs.js';

export interface ListEvidenceFilter {
  /** school grant: what originated in this school and the school still keeps
   * (OQ-12, retainedBySchool). */
  originSchoolId?: string;
  /** own grant: the caller's portfolio, wherever it was created. */
  ownerPersonId?: string;
  /** committee grant: the portfolios of the caller's current evaluatees. */
  ownerPersonIdIn?: string[];
  categoryId?: string;
  status?: EvidenceStatus;
  mappedToIndicatorId?: string;
  page: number;
  pageSize: number;
}

const LIVE_MAPPING_STATUSES = ['owner_confirmed', 'validated', 'returned'] as const;

/** `db` is the client to read through — pass withAreaScope's `tx` so the RLS
 * backstop applies (ADR-0019). Defaults to the unscoped client. */
export async function listEvidence(f: ListEvidenceFilter, db: Prisma.TransactionClient = prisma) {
  if (!f.originSchoolId && !f.ownerPersonId && !f.ownerPersonIdIn) {
    throw new Error('listEvidence needs a scope filter (school, owner or committee) — refusing an unscoped query');
  }
  const where: Prisma.EvidenceWhereInput = {
    deletedAt: null,
    originSchoolId: f.originSchoolId,
    ...(f.originSchoolId ? retainedBySchool(f.originSchoolId) : {}),
    ownerPersonId: f.ownerPersonId ?? (f.ownerPersonIdIn ? { in: f.ownerPersonIdIn } : undefined),
    categoryId: f.categoryId,
    status: f.status,
    ...(f.mappedToIndicatorId
      ? { mappings: { some: { indicatorId: f.mappedToIndicatorId, status: { in: [...LIVE_MAPPING_STATUSES] } } } }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.evidence.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      // scan_status aggregate for list badges (CCR-009) — status columns only
      include: { files: { select: { scanStatus: true, mediaState: true } } },
    }),
    db.evidence.count({ where }),
  ]);
  return { items, total };
}

/**
 * OQ-12 (owner decision 2026-10-13): a school keeps what originated there while
 * the owner still works there; after they leave, only what was used in the
 * school's own evaluation — an item with a live mapping at that school.
 */
export function retainedBySchool(schoolId: string, today = new Date()): Prisma.EvidenceWhereInput {
  return {
    OR: [
      { owner: { account: { memberships: { some: {
        schoolId, status: 'active', effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: startOfDay(today) } }],
      } } } } },
      { mappings: { some: { schoolId, status: { in: [...LIVE_MAPPING_STATUSES] } } } },
    ],
  };
}

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** True when the school still keeps this item (retainedBySchool). */
export async function isRetainedBySchool(evidenceId: string, schoolId: string): Promise<boolean> {
  return (await prisma.evidence.count({ where: { id: evidenceId, ...retainedBySchool(schoolId) } })) > 0;
}

/** Worst-of file scan states for list/detail badges. null = no uploaded files.
 *
 * Order is pending > blocked > unscanned > sanitised > clean (CCR-012): 'clean'
 * is only reported when EVERY file earned it. A file still `uploading` (an open
 * or abandoned upload session) is not part of the item yet and is ignored. */
export function aggregateScanStatus(
  files: { scanStatus: string; mediaState?: string }[],
): 'pending' | 'clean' | 'sanitised' | 'unscanned' | 'blocked' | null {
  const real = files.filter((f) => f.mediaState !== 'uploading');
  if (real.length === 0) return null;
  if (real.some((f) => f.scanStatus === 'pending')) return 'pending';
  if (real.some((f) => f.scanStatus === 'blocked')) return 'blocked';
  if (real.some((f) => f.scanStatus === 'unscanned')) return 'unscanned';
  if (real.some((f) => f.scanStatus === 'sanitised')) return 'sanitised';
  return 'clean';
}

export interface CreateEvidenceInput {
  ownerPersonId: string;
  controllerAreaId: string | null;
  originSchoolId: string;
  uploadedByUserId: string;
  /** CCR-024: false when a school admin uploads for someone else — the owner accepts later. Default true. */
  ownerAccepted?: boolean;
  categoryId: string;
  kind: EvidenceKind;
  title: string;
  description?: string | null;
  linkUrl?: string | null;
  noteText?: string | null;
  capturedAt?: Date | null;
  performedFrom?: Date | null;
  performedTo?: Date | null;
  academicYearBe?: number | null;
  semester?: number | null;
  containsLearners?: ContainsLearners;
  clientUuid: string;
}

/**
 * Returns `{ row, replayed }`. The (owner, client_uuid) unique key makes an
 * offline outbox replay — the same capture sent twice, even under a different
 * Idempotency-Key — return the existing row instead of creating a duplicate.
 * Link and note items have nothing to upload, so they are `active` at once;
 * file items stay `draft` until their first upload completes (CCR-002).
 */
export async function createEvidence(input: CreateEvidenceInput): Promise<{ row: Awaited<ReturnType<typeof prisma.evidence.create>>; replayed: boolean }> {
  const existing = await prisma.evidence.findUnique({
    where: { ownerPersonId_clientUuid: { ownerPersonId: input.ownerPersonId, clientUuid: input.clientUuid } },
  });
  if (existing) return { row: existing, replayed: true };
  const row = await prisma.evidence.create({
    data: {
      ownerPersonId: input.ownerPersonId,
      controllerAreaId: input.controllerAreaId,
      originSchoolId: input.originSchoolId,
      uploadedByUserId: input.uploadedByUserId,
      categoryId: input.categoryId,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      linkUrl: input.linkUrl ?? null,
      noteText: input.noteText ?? null,
      capturedAt: input.capturedAt ?? null,
      performedFrom: input.performedFrom ?? null,
      performedTo: input.performedTo ?? null,
      academicYearBe: input.academicYearBe ?? null,
      semester: input.semester ?? null,
      containsLearners: input.containsLearners ?? 'unknown',
      clientUuid: input.clientUuid,
      status: input.kind === 'file' ? 'draft' : 'active',
      ownerAcceptedAt: input.ownerAccepted === false ? null : new Date(),
    },
  });
  return { row, replayed: false };
}

/** Detail by id with files and mappings. NO tenancy filter: the API authorizes the
 * returned row (owner / origin-school grant / committee) before serving it. */
export async function getEvidenceDetail(evidenceId: string) {
  return prisma.evidence.findFirst({
    where: { id: evidenceId, deletedAt: null },
    include: {
      files: { orderBy: { uploadedAt: 'asc' }, include: { duplicateOf: { select: { evidenceId: true } } } },
      mappings: { orderBy: { ownerConfirmedAt: 'desc' } },
    },
  });
}

export type EvidenceWriteResult<T> =
  | { ok: true; row: T }
  | { ok: false; reason: 'missing' | 'stale' };

export interface EvidencePatchInput {
  title?: string;
  description?: string | null;
  status?: EvidenceStatus;
  capturedAt?: Date | null;
  linkUrl?: string | null;
  noteText?: string | null;
  performedFrom?: Date | null;
  performedTo?: Date | null;
  performedDateSource?: PerformedDateSource | null;
  academicYearBe?: number | null;
  semester?: number | null;
  containsLearners?: ContainsLearners;
  originSchoolId?: string;
}

/** Compare-and-swap on `version` (If-Match). A zero-row update is a missing row
 * (RES-001) or a stale version (RES-004 / 412). */
export async function updateEvidence(evidenceId: string, expectedVersion: number, patch: EvidencePatchInput) {
  const res = await prisma.evidence.updateMany({
    where: { id: evidenceId, deletedAt: null, version: expectedVersion },
    data: { ...patch, version: { increment: 1 } },
  });
  if (res.count === 0) return classifyMiss(evidenceId);
  return { ok: true, row: (await getEvidenceDetail(evidenceId))! } as const;
}

async function classifyMiss(evidenceId: string): Promise<{ ok: false; reason: 'missing' | 'stale' }> {
  const now = await prisma.evidence.findFirst({ where: { id: evidenceId, deletedAt: null }, select: { id: true } });
  return { ok: false, reason: now ? 'stale' : 'missing' };
}

/** Promotes draft -> active (CCR-002) — a no-op if already active. */
export async function markEvidenceActiveIfDraft(evidenceId: string) {
  await prisma.evidence.updateMany({
    where: { id: evidenceId, status: 'draft' },
    data: { status: 'active', version: { increment: 1 } },
  });
}

export async function softDeleteEvidence(evidenceId: string, expectedVersion: number): Promise<EvidenceWriteResult<true>> {
  const res = await prisma.evidence.updateMany({
    where: { id: evidenceId, deletedAt: null, version: expectedVersion },
    data: { deletedAt: new Date(), version: { increment: 1 } },
  });
  if (res.count === 0) return classifyMiss(evidenceId);
  return { ok: true, row: true };
}

// ── files ──

export interface CreateFileInput {
  id: string; // client-facing file_id
  evidenceId: string;
  storageUri: string;
  contentType: string;
  byteSize: bigint;
  checksumSha256: string;
  durationSeconds: number | null;
  originalFilename: string;
}

/** A file row in its final, uploaded state — for fixtures and operator tools
 * that put bytes in storage themselves. The API path is the upload session
 * (uploads.ts), which creates the row as `uploading` and completes it there.
 * Throws P2002 on a duplicate id. */
export async function createEvidenceFile(input: CreateFileInput) {
  return prisma.evidenceFile.create({
    data: {
      id: input.id,
      evidenceId: input.evidenceId,
      storageProvider: 's3_compatible',
      storageUri: input.storageUri,
      contentType: input.contentType,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      durationSeconds: input.durationSeconds,
      originalFilename: input.originalFilename,
      scanStatus: 'pending',
      mediaState: 'verifying',
    },
  });
}

/**
 * Register an already-stored file and queue its processing: file row + draft→active
 * + outbox `evidence.file.registered` + worker job `file.process` in ONE
 * transaction (module-boundaries rule 4). The API's completeUpload does the same
 * through uploads.ts; this entry point serves fixtures and operator tools.
 */
export async function registerEvidenceFileWithWorkerJobs(input: CreateFileInput & {
  schoolId: string;
  actorUserId: string | null;
  requestId?: string | null;
}) {
  const outboxId = randomUUID();
  return prisma.$transaction(async (tx) => {
    const file = await tx.evidenceFile.create({
      data: {
        id: input.id,
        evidenceId: input.evidenceId,
        storageProvider: 's3_compatible',
        storageUri: input.storageUri,
        contentType: input.contentType,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
        durationSeconds: input.durationSeconds,
        originalFilename: input.originalFilename,
        scanStatus: 'pending',
        mediaState: 'verifying',
      },
    });

    await tx.evidence.updateMany({
      where: { id: input.evidenceId, status: 'draft' },
      data: { status: 'active', version: { increment: 1 } },
    });

    await enqueueOutboxEvent({
      id: outboxId,
      eventType: 'evidence.file.registered',
      schoolId: input.schoolId,
      actorUserId: input.actorUserId,
      requestId: input.requestId ?? null,
      payload: {
        evidence_id: input.evidenceId,
        file_id: file.id,
        content_type: input.contentType,
        byte_size: Number(input.byteSize),
      },
    }, tx);

    await enqueueWorkerJob({
      jobType: 'file.process',
      payload: {
        file_id: file.id,
        evidence_id: input.evidenceId,
        school_id: input.schoolId,
        outbox_event_id: outboxId,
      },
    }, tx);

    return file;
  });
}

export async function countFilesForEvidence(evidenceId: string): Promise<number> {
  return prisma.evidenceFile.count({ where: { evidenceId } });
}

/** schoolId first and folded into the query, matching this file's own
 * tenancy-by-construction convention (module header) — a cross-school file id
 * returns null here rather than a row the caller must remember to reject. */
/** By id alone: the item may have moved school (CCR-024) since the job was
 * queued, so the job's school_id is not a filter. The caller checks evidenceId. */
export async function getEvidenceFileById(fileId: string) {
  return prisma.evidenceFile.findFirst({
    where: { id: fileId },
    include: { evidence: { select: { id: true, originSchoolId: true, deletedAt: true, category: { select: { maxDurationSeconds: true } } } } },
  });
}

/** FR-021: what the server measured replaces what the client declared. */
export async function recordMediaProbe(fileId: string, probe: { durationMs: number | null; width: number | null; height: number | null }) {
  return prisma.evidenceFile.update({
    where: { id: fileId },
    data: {
      durationMs: probe.durationMs,
      durationSeconds: probe.durationMs === null ? null : Math.ceil(probe.durationMs / 1000),
      width: probe.width,
      height: probe.height,
    },
  });
}

/**
 * `scanned` is the receipt, and it is NOT implied by the status (ADR-0009).
 *
 * Pass true only when clamd actually read the bytes and returned a verdict. Every
 * other path leaves `scannedAt` null, which is what makes the file selectable by a
 * later sweep: `unscanned` never had a scanner, and a file blocked on size or on a
 * size mismatch was refused *without being read*, so "could not be checked" must
 * stay re-checkable instead of hardening into a permanent answer.
 *
 * Setting scannedAt for those would be the same class of lie as the filename stub
 * CCR-012 deleted — a record of a check that never happened.
 */
export async function setFileScanStatus(
  fileId: string,
  status: 'clean' | 'sanitised' | 'unscanned' | 'blocked',
  opts: { scanned: boolean },
) {
  return prisma.evidenceFile.update({
    where: { id: fileId },
    data: { scanStatus: status, ...(opts.scanned ? { scannedAt: new Date() } : {}) },
  });
}

export async function setFileDurationSeconds(fileId: string, durationSeconds: number) {
  return prisma.evidenceFile.update({
    where: { id: fileId },
    data: { durationSeconds, durationMs: durationSeconds * 1000 },
  });
}

/** The worker re-hashed the stored object (ADR-0018). A match records the receipt;
 * a mismatch is the caller's to block. */
export async function markFileSha256Verified(fileId: string) {
  return prisma.evidenceFile.update({ where: { id: fileId }, data: { sha256VerifiedAt: new Date() } });
}

export async function setFileMediaState(fileId: string, mediaState: 'verifying' | 'processing' | 'ready' | 'failed') {
  return prisma.evidenceFile.update({ where: { id: fileId }, data: { mediaState } });
}

/** Soft-deleted evidence whose files are eligible for storage GC. */
export async function listFilesForStorageGc(cutoff: Date, limit = 50) {
  return prisma.evidenceFile.findMany({
    where: {
      evidence: { deletedAt: { not: null, lte: cutoff } },
    },
    take: limit,
    include: { evidence: { select: { id: true, originSchoolId: true, deletedAt: true } } },
  });
}

export async function deleteEvidenceFileRow(fileId: string) {
  return prisma.evidenceFile.delete({ where: { id: fileId } });
}

// ─────────────────── re-scan sweep (ADR-0009) ───────────────────

export interface RescanSelection {
  /** Only files in these scan states. `blocked` is excluded by default — see the CLI. */
  statuses: ('pending' | 'clean' | 'sanitised' | 'unscanned' | 'blocked')[];
  /** Null → "never scanned by a real scanner". A date → also re-scan verdicts
   * older than it, which is how a signature update gets swept in. */
  scannedBefore?: Date | null;
  schoolId?: string;
  limit: number;
}

function rescanWhere(sel: RescanSelection) {
  return {
    scanStatus: { in: sel.statuses },
    // The whole point of the sweep. `null` covers stub-`clean` rows, `unscanned`
    // rows, and anything refused without being read; `scannedBefore` additionally
    // catches genuine but stale verdicts.
    ...(sel.scannedBefore
      ? { OR: [{ scannedAt: null }, { scannedAt: { lt: sel.scannedBefore } }] }
      : { scannedAt: null }),
    evidence: {
      // Soft-deleted evidence is on its way to storage GC, which will delete the
      // object out from under any job queued for it — the scan would fail on a
      // missing object, burn its 8 retries and land in `failed`, making a clean
      // sweep look broken. Skipping them is not laziness about coverage: these
      // files are already unreachable through the API.
      deletedAt: null,
      ...(sel.schoolId ? { originSchoolId: sel.schoolId } : {}),
    },
  };
}

/** Files a re-scan should cover, oldest upload first so the longest-unverified
 * evidence is dealt with before anything recent. */
export async function listFilesForRescan(sel: RescanSelection) {
  return prisma.evidenceFile.findMany({
    where: rescanWhere(sel),
    orderBy: { uploadedAt: 'asc' },
    take: sel.limit,
    select: {
      id: true,
      evidenceId: true,
      byteSize: true,
      scanStatus: true,
      uploadedAt: true,
      evidence: { select: { originSchoolId: true } },
    },
  });
}

export async function countFilesForRescan(sel: Omit<RescanSelection, 'limit'>): Promise<number> {
  return prisma.evidenceFile.count({ where: rescanWhere({ ...sel, limit: 0 }) });
}

/**
 * Scan-coverage census: how many files are in each state, and how many of those
 * carry a real verdict. The two numbers disagreeing is the finding — 81 rows
 * reading `clean` with 0 receipts is what prompted this whole sweep.
 */
export async function scanCoverageCensus(schoolId?: string): Promise<{
  rows: { scanStatus: string; total: number; verified: number }[];
  softDeleted: number;
}> {
  // Counts LIVE evidence only. Soft-deleted files are not served through the API
  // and are queued for storage GC, so folding them in overstates the thing this
  // census exists to alarm about — "how many files are we serving that claim a
  // verdict nobody earned". The first full-store run reported 27 unverified
  // `clean` files as "downloadable, badged ปลอดภัย" when a chunk of them were
  // soft-deleted and downloadable by nobody. They are reported separately
  // instead of hidden, because a soft-deleted file can still be restored.
  const live = { evidence: { deletedAt: null, ...(schoolId ? { originSchoolId: schoolId } : {}) } };
  const [totals, verified, softDeleted] = await Promise.all([
    prisma.evidenceFile.groupBy({ by: ['scanStatus'], where: live, _count: { _all: true } }),
    prisma.evidenceFile.groupBy({
      by: ['scanStatus'],
      where: { ...live, scannedAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.evidenceFile.count({
      where: {
        scannedAt: null,
        evidence: { deletedAt: { not: null }, ...(schoolId ? { originSchoolId: schoolId } : {}) },
      },
    }),
  ]);
  const verifiedBy = new Map(verified.map((r) => [r.scanStatus, r._count._all]));
  return {
    rows: totals.map((r) => ({
      scanStatus: r.scanStatus,
      total: r._count._all,
      verified: verifiedBy.get(r.scanStatus) ?? 0,
    })),
    softDeleted,
  };
}

/** CCR-024: the owner accepts an item uploaded on their behalf. Idempotent. */
export async function acceptEvidenceByOwner(evidenceId: string, now = new Date()) {
  await prisma.evidence.updateMany({
    where: { id: evidenceId, deletedAt: null, ownerAcceptedAt: null },
    data: { ownerAcceptedAt: now, version: { increment: 1 } },
  });
  return getEvidenceDetail(evidenceId);
}

/**
 * FR-012 / CCR-026: the person's live items holding these exact, server-verified
 * bytes, newest first. `excludeEvidenceId` leaves out the item being uploaded.
 */
export async function findOwnerFilesByChecksum(ownerPersonId: string, checksumSha256: string, excludeEvidenceId?: string) {
  const rows = await prisma.evidenceFile.findMany({
    where: {
      checksumSha256, sha256VerifiedAt: { not: null },
      evidence: { ownerPersonId, deletedAt: null, ...(excludeEvidenceId ? { id: { not: excludeEvidenceId } } : {}) },
    },
    select: { id: true, evidenceId: true, uploadedAt: true, evidence: { select: { title: true } } },
    orderBy: { uploadedAt: 'desc' },
    take: 20,
  });
  return rows.map((r) => ({ fileId: r.id, evidenceId: r.evidenceId, title: r.evidence.title, uploadedAt: r.uploadedAt }));
}

/** After the server's re-hash: record the owner's earlier file with the same bytes, if any. */
export async function markDuplicateIfAny(fileId: string) {
  const file = await prisma.evidenceFile.findUnique({
    where: { id: fileId }, select: { checksumSha256: true, evidenceId: true, uploadedAt: true, evidence: { select: { ownerPersonId: true } } },
  });
  if (!file) return null;
  const earlier = await prisma.evidenceFile.findFirst({
    where: {
      id: { not: fileId }, checksumSha256: file.checksumSha256, sha256VerifiedAt: { not: null },
      evidence: { ownerPersonId: file.evidence.ownerPersonId, deletedAt: null, id: { not: file.evidenceId } },
    },
    orderBy: { uploadedAt: 'asc' },
    select: { id: true, evidenceId: true },
  });
  if (!earlier) return null;
  await prisma.evidenceFile.update({ where: { id: fileId }, data: { duplicateOfFileId: earlier.id } });
  return earlier;
}
