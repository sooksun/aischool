// Evidence + EvidenceFile. Every function takes `schoolId` as the first, required
// parameter and folds it into the WHERE clause — SEC-TEN-1 ("school-scoped by
// construction"): there is no code path here that can return another school's row,
// because there is no query that omits the filter. A cross-school id therefore
// returns `null`, indistinguishable from a truly-missing id (RES-001 by design,
// permissions.yaml tenancy rule) — callers must not turn a null into a 403.
import { randomUUID } from 'node:crypto';
import { prisma } from '../client.js';
import type { EvidenceStatus, Prisma } from '@prisma/client';
import { enqueueOutboxEvent } from './outbox.js';
import { enqueueWorkerJob } from './jobs.js';

export interface ListEvidenceFilter {
  ownerPersonnelId?: string; // undefined = no owner filter (school-wide grant); set = 'own' grant
  /** 'committee' grant: evidence owned by any evaluatee the caller currently sits
   * on a committee for. Mutually exclusive with ownerPersonnelId in practice (the
   * route layer sets exactly one), but both are honored if ever combined. */
  ownerPersonnelIdIn?: string[];
  categoryId?: string;
  status?: EvidenceStatus;
  mappedToIndicatorId?: string;
  page: number;
  pageSize: number;
}

const ACTIVE_MAPPING_STATUSES = ['suggested', 'confirmed'] as const;

export async function listEvidence(schoolId: string, f: ListEvidenceFilter) {
  const where: Prisma.EvidenceWhereInput = {
    schoolId,
    deletedAt: null,
    ownerPersonnelId: f.ownerPersonnelId ?? (f.ownerPersonnelIdIn ? { in: f.ownerPersonnelIdIn } : undefined),
    categoryId: f.categoryId,
    status: f.status,
    ...(f.mappedToIndicatorId
      ? { mappings: { some: { indicatorId: f.mappedToIndicatorId, status: { in: [...ACTIVE_MAPPING_STATUSES] } } } }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.evidence.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      // scan_status aggregate for list badges (CCR-009) — only status columns, not bytes
      include: { files: { select: { scanStatus: true } } },
    }),
    prisma.evidence.count({ where }),
  ]);
  return { items, total };
}

/** Worst-of file scan states for list/detail badges. null = no files.
 *
 * Order is pending > blocked > unscanned > clean (CCR-012): 'clean' is only
 * reported when EVERY file earned it, so one unverified file cannot hide behind
 * a set of scanned ones. */
export function aggregateScanStatus(
  files: { scanStatus: string }[],
): 'pending' | 'clean' | 'unscanned' | 'blocked' | null {
  if (files.length === 0) return null;
  if (files.some((f) => f.scanStatus === 'pending')) return 'pending';
  if (files.some((f) => f.scanStatus === 'blocked')) return 'blocked';
  if (files.some((f) => f.scanStatus === 'unscanned')) return 'unscanned';
  return 'clean';
}

export async function createEvidence(schoolId: string, data: {
  ownerPersonnelId: string;
  uploadedByUserId: string;
  categoryId: string;
  title: string;
  description?: string | null;
  capturedAt?: Date | null;
}) {
  return prisma.evidence.create({
    data: {
      schoolId,
      ownerPersonnelId: data.ownerPersonnelId,
      uploadedByUserId: data.uploadedByUserId,
      categoryId: data.categoryId,
      title: data.title,
      description: data.description ?? null,
      capturedAt: data.capturedAt ?? null,
      status: 'draft', // CCR-002: draft -> active happens on first completed upload, not here
    },
  });
}

export async function getEvidenceDetail(schoolId: string, evidenceId: string) {
  return prisma.evidence.findFirst({
    where: { id: evidenceId, schoolId, deletedAt: null },
    include: {
      files: { orderBy: { uploadedAt: 'asc' } },
      mappings: { orderBy: { mappedAt: 'desc' } },
    },
  });
}

export async function getEvidenceOwnerAndStatus(schoolId: string, evidenceId: string) {
  return prisma.evidence.findFirst({
    where: { id: evidenceId, schoolId, deletedAt: null },
    select: { id: true, ownerPersonnelId: true, status: true },
  });
}

/** Returns the updated row, or null if evidenceId doesn't exist in this school
 * (updateMany never throws on zero matches — that's what makes the tenancy check
 * "by construction" instead of "check-then-update", which would have a TOCTOU gap). */
export async function updateEvidence(schoolId: string, evidenceId: string, patch: {
  title?: string;
  description?: string | null;
  status?: EvidenceStatus;
  capturedAt?: Date | null;
}) {
  const result = await prisma.evidence.updateMany({
    where: { id: evidenceId, schoolId, deletedAt: null },
    data: patch,
  });
  if (result.count === 0) return null;
  return getEvidenceDetail(schoolId, evidenceId);
}

/** Promotes draft -> active. Called by the API after the FIRST file upload
 * completes successfully (CCR-002 lifecycle) — a no-op if already active. */
export async function markEvidenceActiveIfDraft(schoolId: string, evidenceId: string) {
  await prisma.evidence.updateMany({
    where: { id: evidenceId, schoolId, status: 'draft' },
    data: { status: 'active' },
  });
}

export async function softDeleteEvidence(schoolId: string, evidenceId: string): Promise<boolean> {
  const result = await prisma.evidence.updateMany({
    where: { id: evidenceId, schoolId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count > 0;
}

// ── files ──

export interface CreateFileInput {
  id: string; // client-facing file_id, issued at initiate (see apps/api upload routes)
  evidenceId: string;
  storageUri: string;
  contentType: string;
  byteSize: bigint;
  checksumSha256: string;
  durationSeconds: number | null;
  originalFilename: string;
}

/** Throws Prisma's P2002 (unique violation on the `id` PK) if this file_id was
 * already completed — the caller maps that to UPL-004. No separate "already
 * completed" flag needed: the row's existence IS the signal (see evidence.ts
 * module header — initiate never writes a row, only complete does). */
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
    },
  });
}

/**
 * Complete-file path for the API: file row + draft→active + outbox
 * `evidence.file.registered` + worker job `file.process` in ONE transaction
 * (module-boundaries rule 4 — no dual-write after commit).
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
      },
    });

    await tx.evidence.updateMany({
      where: { id: input.evidenceId, schoolId: input.schoolId, status: 'draft' },
      data: { status: 'active' },
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
export async function getEvidenceFileById(schoolId: string, fileId: string) {
  return prisma.evidenceFile.findFirst({
    where: { id: fileId, evidence: { schoolId } },
    include: { evidence: { select: { id: true, schoolId: true, deletedAt: true } } },
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
  status: 'clean' | 'unscanned' | 'blocked',
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
    data: { durationSeconds },
  });
}

/** Soft-deleted evidence whose files are eligible for storage GC. */
export async function listFilesForStorageGc(cutoff: Date, limit = 50) {
  return prisma.evidenceFile.findMany({
    where: {
      evidence: { deletedAt: { not: null, lte: cutoff } },
    },
    take: limit,
    include: { evidence: { select: { id: true, schoolId: true, deletedAt: true } } },
  });
}

export async function deleteEvidenceFileRow(fileId: string) {
  return prisma.evidenceFile.delete({ where: { id: fileId } });
}

// ─────────────────── re-scan sweep (ADR-0009) ───────────────────

export interface RescanSelection {
  /** Only files in these scan states. `blocked` is excluded by default — see the CLI. */
  statuses: ('pending' | 'clean' | 'unscanned' | 'blocked')[];
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
      ...(sel.schoolId ? { schoolId: sel.schoolId } : {}),
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
      evidence: { select: { schoolId: true } },
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
  const live = { evidence: { deletedAt: null, ...(schoolId ? { schoolId } : {}) } };
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
        evidence: { deletedAt: { not: null }, ...(schoolId ? { schoolId } : {}) },
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
