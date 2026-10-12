// Upload sessions (ADR-0016 §5, CCR-017). A session is opened against an evidence
// item; its file row exists from the start as `uploading`, so a resume can find
// it, and an abandoned session is something the GC can see and expire. The
// object store is touched only by the API (presign / ListParts / complete) — these
// functions own the database side and the hand-off to the worker.
import { randomUUID } from 'node:crypto';
import type { UploadProtocol } from '@prisma/client';
import { prisma } from '../client.js';
import { enqueueOutboxEvent } from './outbox.js';
import { enqueueWorkerJob } from './jobs.js';

export const UPLOAD_PART_SIZE = 16 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function openUploadSession(input: {
  evidenceId: string;
  fileId: string;
  storageUri: string;
  contentType: string;
  byteSize: bigint;
  checksumSha256: string;
  originalFilename: string;
  durationMs: number | null;
  protocol: UploadProtocol;
  s3UploadId: string | null;
  createdByUserId: string;
}) {
  const partSize = input.protocol === 'single_put' ? Number(input.byteSize) : UPLOAD_PART_SIZE;
  const partCount = input.protocol === 'single_put' ? 1 : Math.ceil(Number(input.byteSize) / UPLOAD_PART_SIZE);
  return prisma.$transaction(async (tx) => {
    await tx.evidenceFile.create({
      data: {
        id: input.fileId,
        evidenceId: input.evidenceId,
        storageProvider: 's3_compatible',
        storageUri: input.storageUri,
        contentType: input.contentType,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
        originalFilename: input.originalFilename,
        durationMs: input.durationMs,
        durationSeconds: input.durationMs == null ? null : Math.round(input.durationMs / 1000),
        scanStatus: 'pending',
        mediaState: 'uploading',
        role: 'original',
      },
    });
    return tx.uploadSession.create({
      data: {
        evidenceId: input.evidenceId,
        fileId: input.fileId,
        protocol: input.protocol,
        s3UploadId: input.s3UploadId,
        partSize,
        partCount,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
        createdByUserId: input.createdByUserId,
        expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS),
      },
      include: { file: true, evidence: { select: { id: true, ownerPersonId: true, originSchoolId: true, deletedAt: true } } },
    });
  });
}

export async function getUploadSession(uploadId: string) {
  return prisma.uploadSession.findUnique({
    where: { id: uploadId },
    include: { file: true, evidence: { select: { id: true, ownerPersonId: true, originSchoolId: true, deletedAt: true } } },
  });
}

/** Claim the session for completion (open → completing) so two concurrent
 * completes cannot both finish it. false → it was not open (UPL-007). */
export async function claimUploadForCompletion(uploadId: string): Promise<boolean> {
  const res = await prisma.uploadSession.updateMany({
    where: { id: uploadId, status: 'open', expiresAt: { gt: new Date() } },
    data: { status: 'completing' },
  });
  return res.count === 1;
}

/** Put a claimed session back to open (the store-side complete failed). */
export async function releaseUploadClaim(uploadId: string) {
  await prisma.uploadSession.updateMany({ where: { id: uploadId, status: 'completing' }, data: { status: 'open' } });
}

/**
 * The object is in storage. In ONE transaction: session completed, file
 * `verifying`, evidence draft → active, outbox `evidence.file.registered`, and the
 * worker job that re-hashes, scans and probes it (ADR-0018).
 */
export async function finishUpload(input: {
  uploadId: string;
  fileId: string;
  evidenceId: string;
  originSchoolId: string;
  contentType: string;
  byteSize: bigint;
  actorUserId: string;
  requestId?: string | null;
}) {
  const outboxId = randomUUID();
  return prisma.$transaction(async (tx) => {
    await tx.uploadSession.update({ where: { id: input.uploadId }, data: { status: 'completed' } });
    const file = await tx.evidenceFile.update({ where: { id: input.fileId }, data: { mediaState: 'verifying' } });
    await tx.evidence.updateMany({
      where: { id: input.evidenceId, status: 'draft' },
      data: { status: 'active', version: { increment: 1 } },
    });
    await enqueueOutboxEvent({
      id: outboxId,
      eventType: 'evidence.file.registered',
      schoolId: input.originSchoolId,
      actorUserId: input.actorUserId,
      requestId: input.requestId ?? null,
      payload: { evidence_id: input.evidenceId, file_id: input.fileId, content_type: input.contentType, byte_size: Number(input.byteSize) },
    }, tx);
    await enqueueWorkerJob({
      jobType: 'file.process',
      payload: { file_id: input.fileId, evidence_id: input.evidenceId, school_id: input.originSchoolId, outbox_event_id: outboxId },
    }, tx);
    return file;
  });
}

/** Abort: the session ends and its never-completed file row goes with it. */
export async function abortUploadSession(uploadId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const s = await tx.uploadSession.findUnique({ where: { id: uploadId }, select: { status: true, fileId: true } });
    if (!s || s.status !== 'open') return false;
    await tx.uploadSession.update({ where: { id: uploadId }, data: { status: 'aborted' } });
    await tx.evidenceFile.deleteMany({ where: { id: s.fileId, mediaState: 'uploading' } });
    return true;
  });
}
