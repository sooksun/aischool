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
    }),
    prisma.evidence.count({ where }),
  ]);
  return { items, total };
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

export async function getEvidenceFileById(fileId: string) {
  return prisma.evidenceFile.findUnique({
    where: { id: fileId },
    include: { evidence: { select: { id: true, schoolId: true, deletedAt: true } } },
  });
}

export async function setFileScanStatus(fileId: string, status: 'clean' | 'blocked') {
  return prisma.evidenceFile.update({ where: { id: fileId }, data: { scanStatus: status } });
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
