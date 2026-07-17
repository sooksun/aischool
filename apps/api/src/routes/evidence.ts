// Evidence CRUD + two-phase upload. Every handler resolves its grant from
// permissions.yaml (resolveGrant) and, for 'own', checks the caller is actually
// the resource's owner (requireOwnership) — holding the role is necessary but not
// sufficient for an 'own' grant.
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listEvidence, createEvidence, getEvidenceDetail, updateEvidence, softDeleteEvidence,
  registerEvidenceFileWithWorkerJobs, getEvidenceCategoryById, writeAuditEvent,
  listEvaluateePersonnelIdsForCommitteeMember, aggregateScanStatus,
} from '@seip/database';
import { ApiError, forbiddenAreaWrite } from '@seip/backend-shared';
import { Prisma } from '@prisma/client';
import { requireCurrentSchool } from '../plugins/auth.js';
import { resolveGrant, requireOwnership, requireCommitteeAccessToPersonnel } from '../lib/permission-guard.js';
import type { S3Client } from '@aws-sdk/client-s3';
import { createS3Client, evidenceObjectKey, presignUpload, presignDownload } from '../lib/s3.js';
import type { Env } from '../env.js';

function serializeEvidence(e: {
  id: string; schoolId: string; ownerPersonnelId: string; uploadedByUserId: string;
  categoryId: string; title: string; description: string | null; status: string;
  capturedAt: Date | null; createdAt: Date;
  files?: { scanStatus: string }[];
}) {
  return {
    id: e.id, school_id: e.schoolId, owner_personnel_id: e.ownerPersonnelId,
    uploaded_by_user_id: e.uploadedByUserId, category_id: e.categoryId, title: e.title,
    description: e.description, status: e.status,
    captured_at: e.capturedAt?.toISOString() ?? null, created_at: e.createdAt.toISOString(),
    scan_status: aggregateScanStatus(e.files ?? []),
  };
}

/** UPL-006: download_url only when scan_status=clean; never expose storageUri. */
async function serializeFile(
  f: {
    id: string;
    evidenceId: string;
    contentType: string;
    byteSize: bigint;
    checksumSha256: string;
    durationSeconds: number | null;
    originalFilename: string;
    scanStatus: string;
    uploadedAt: Date;
    storageUri: string;
  },
  s3: S3Client,
  bucket: string,
) {
  let download_url: string | null = null;
  if (f.scanStatus === 'clean') {
    const { downloadUrl } = await presignDownload(s3, bucket, f.storageUri, f.originalFilename);
    download_url = downloadUrl;
  }
  return {
    id: f.id,
    evidence_id: f.evidenceId,
    content_type: f.contentType,
    byte_size: Number(f.byteSize),
    checksum_sha256: f.checksumSha256,
    duration_seconds: f.durationSeconds,
    original_filename: f.originalFilename,
    scan_status: f.scanStatus,
    download_url,
    uploaded_at: f.uploadedAt.toISOString(),
  };
}

export const evidenceRoutes: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const s3 = createS3Client(env);

  app.get('/evidence', { config: { operationId: 'listEvidence' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('listEvidence', auth, schoolId);

    const q = z.object({
      owner_personnel_id: z.string().uuid().optional(),
      category_id: z.string().uuid().optional(),
      status: z.enum(['draft', 'active', 'archived', 'rejected']).optional(),
      mapped_to_indicator_id: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query);

    // 'own' forces the filter to the caller regardless of what the client asked for
    // — this is the enforcement point, not a UI nicety (SEC-TEN-1 applied to roles,
    // not just schools).
    let ownerFilter = grant === 'own' ? auth.personnel?.id : q.owner_personnel_id;
    if (grant === 'own' && q.owner_personnel_id && q.owner_personnel_id !== auth.personnel?.id) {
      throw new ApiError('PERM-001', "own-scoped role may not list another owner's evidence");
    }

    let ownerFilterIn: string[] | undefined;
    if (grant === 'committee') {
      const evaluateeIds = await listEvaluateePersonnelIdsForCommitteeMember(schoolId, auth.userId);
      if (q.owner_personnel_id) {
        if (!evaluateeIds.includes(q.owner_personnel_id)) {
          throw new ApiError('PERM-001', 'Not a committee member for this owner');
        }
        ownerFilter = q.owner_personnel_id;
      } else {
        ownerFilterIn = evaluateeIds;
      }
    }

    const { items, total } = await listEvidence(schoolId, {
      ownerPersonnelId: ownerFilter,
      ownerPersonnelIdIn: ownerFilterIn,
      categoryId: q.category_id,
      status: q.status,
      mappedToIndicatorId: q.mapped_to_indicator_id,
      page: q.page,
      pageSize: q.page_size,
    });
    return { items: items.map(serializeEvidence), meta: { page: q.page, page_size: q.page_size, total } };
  });

  app.post('/evidence', { config: { operationId: 'createEvidence' } }, async (request, reply) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('createEvidence', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const body = z.object({
      owner_personnel_id: z.string().uuid().nullable().optional(),
      category_id: z.string().uuid(),
      title: z.string().min(1).max(300),
      description: z.string().max(2000).nullable().optional(),
      captured_at: z.string().datetime().nullable().optional(),
    }).parse(request.body);

    const ownerPersonnelId = body.owner_personnel_id ?? auth.personnel?.id;
    if (!ownerPersonnelId) throw new ApiError('VAL-002', 'owner_personnel_id required when the caller has no personnel profile');
    if (grant === 'own' && ownerPersonnelId !== auth.personnel?.id) {
      throw new ApiError('PERM-001', 'own-scoped role may only create evidence for themselves');
    }

    const category = await getEvidenceCategoryById(body.category_id);
    if (!category) throw new ApiError('VAL-002', 'Unknown category_id');

    const evidence = await createEvidence(schoolId, {
      ownerPersonnelId, uploadedByUserId: auth.userId, categoryId: body.category_id,
      title: body.title, description: body.description ?? null,
      capturedAt: body.captured_at ? new Date(body.captured_at) : null,
    });

    await writeAuditEvent({
      schoolId, actorUserId: auth.userId, action: 'created', entityType: 'Evidence',
      entityId: evidence.id, after: evidence, requestId: request.id,
    });

    reply.status(201).send(serializeEvidence(evidence));
  });

  app.get('/evidence/:evidenceId', { config: { operationId: 'getEvidence' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);

    const grant = await resolveGrant('getEvidence', auth, schoolId);

    const detail = await getEvidenceDetail(schoolId, evidenceId);
    if (!detail) throw new ApiError('RES-001', 'Evidence not found');
    if (grant === 'own') requireOwnership(auth, detail.ownerPersonnelId);
    if (grant === 'committee') await requireCommitteeAccessToPersonnel(schoolId, auth.userId, detail.ownerPersonnelId);

    return {
      ...serializeEvidence(detail),
      files: await Promise.all(detail.files.map((f) => serializeFile(f, s3, env.S3_BUCKET))),
      mappings: detail.mappings.map((m) => ({
        id: m.id, evidence_id: m.evidenceId, indicator_id: m.indicatorId, cycle_id: m.cycleId,
        mapping_source: m.mappingSource, status: m.status, rationale: m.rationale,
        mapped_by_user_id: m.mappedByUserId, confirmed_by_user_id: m.confirmedByUserId,
        mapped_at: m.mappedAt.toISOString(), confirmed_at: m.confirmedAt?.toISOString() ?? null,
      })),
    };
  });

  app.patch('/evidence/:evidenceId', { config: { operationId: 'updateEvidence' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const grant = await resolveGrant('updateEvidence', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const existing = await getEvidenceDetail(schoolId, evidenceId);
    if (!existing) throw new ApiError('RES-001', 'Evidence not found');
    if (grant === 'own') requireOwnership(auth, existing.ownerPersonnelId);

    const patch = z.object({
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(2000).nullable().optional(),
      status: z.enum(['draft', 'active', 'archived', 'rejected']).optional(),
      captured_at: z.string().datetime().nullable().optional(),
    }).refine((p) => Object.keys(p).length > 0, 'at least one field required').parse(request.body);

    const updated = await updateEvidence(schoolId, evidenceId, {
      title: patch.title, description: patch.description,
      status: patch.status, capturedAt: patch.captured_at ? new Date(patch.captured_at) : undefined,
    });
    if (!updated) throw new ApiError('RES-001', 'Evidence not found');

    await writeAuditEvent({
      schoolId, actorUserId: auth.userId, action: 'updated', entityType: 'Evidence', entityId: evidenceId,
      before: existing, after: updated, requestId: request.id,
    });
    return serializeEvidence(updated);
  });

  app.delete('/evidence/:evidenceId', { config: { operationId: 'deleteEvidence' } }, async (request, reply) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const grant = await resolveGrant('deleteEvidence', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const existing = await getEvidenceDetail(schoolId, evidenceId);
    if (!existing) throw new ApiError('RES-001', 'Evidence not found');
    if (grant === 'own') requireOwnership(auth, existing.ownerPersonnelId);

    const deleted = await softDeleteEvidence(schoolId, evidenceId);
    if (!deleted) throw new ApiError('RES-001', 'Evidence not found');

    await writeAuditEvent({
      schoolId, actorUserId: auth.userId, action: 'soft_deleted', entityType: 'Evidence',
      entityId: evidenceId, before: existing, requestId: request.id,
    });
    reply.status(204).send();
  });

  app.post('/evidence/:evidenceId/files/initiate', { config: { operationId: 'initiateFileUpload' } }, async (request, reply) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const grant = await resolveGrant('initiateFileUpload', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const evidence = await getEvidenceDetail(schoolId, evidenceId);
    if (!evidence) throw new ApiError('RES-001', 'Evidence not found');
    if (grant === 'own') requireOwnership(auth, evidence.ownerPersonnelId);

    const body = z.object({
      content_type: z.string().min(1),
      byte_size: z.number().int().positive(),
      checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      original_filename: z.string().max(255),
      duration_seconds: z.number().int().positive().nullable().optional(),
    }).parse(request.body);

    const category = await getEvidenceCategoryById(evidence.categoryId);
    if (!category) throw new ApiError('SYS-001', "evidence's own category vanished");

    if (!category.allowedMimeTypes.includes(body.content_type)) {
      throw new ApiError('UPL-001', `content type ${body.content_type} not allowed for category ${category.code}`,
        [{ field: 'content_type', issue: `must be one of: ${category.allowedMimeTypes.join(', ')}` }]);
    }
    if (category.maxByteSize && BigInt(body.byte_size) > category.maxByteSize) {
      throw new ApiError('UPL-002', `file exceeds ${category.maxByteSize} bytes for category ${category.code}`);
    }
    // CCR-002: duration is fail-fast ONLY when the client supplied it — the server
    // probe (worker, not yet implemented) is the true UPL-003 authority post-upload.
    if (category.maxDurationSeconds && body.duration_seconds && body.duration_seconds > category.maxDurationSeconds) {
      throw new ApiError('UPL-003', `duration ${body.duration_seconds}s exceeds ${category.maxDurationSeconds}s for category ${category.code}`);
    }

    // fileId + the object key are deterministic from (schoolId, evidenceId, fileId,
    // filename) — see CCR-004: complete() re-derives the same key and re-validates
    // against category rules rather than trusting a server-side upload session,
    // which this MVP slice doesn't have. Nothing is persisted here; an abandoned
    // initiate (client never completes) leaves no row to clean up.
    const fileId = randomUUID();
    const key = evidenceObjectKey(schoolId, evidenceId, fileId, body.original_filename);
    const { uploadUrl, expiresAt } = await presignUpload(s3, env.S3_BUCKET, key, body.content_type);

    reply.status(201).send({
      file_id: fileId, upload_url: uploadUrl, method: 'PUT', headers: { 'Content-Type': body.content_type },
      expires_at: expiresAt.toISOString(),
    });
  });

  app.post('/evidence/:evidenceId/files/:fileId/complete', { config: { operationId: 'completeFileUpload' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { evidenceId, fileId } = z.object({
      evidenceId: z.string().uuid(), fileId: z.string().uuid(),
    }).parse(request.params);
    const grant = await resolveGrant('completeFileUpload', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const evidence = await getEvidenceDetail(schoolId, evidenceId);
    if (!evidence) throw new ApiError('RES-001', 'Evidence not found');
    if (grant === 'own') requireOwnership(auth, evidence.ownerPersonnelId);

    // CCR-004: request body widened beyond FileUploadComplete's single
    // checksum_sha256 field — see docs/reviews/CCR-004-*.md for why.
    const body = z.object({
      checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      content_type: z.string().min(1),
      byte_size: z.number().int().positive(),
      original_filename: z.string().max(255),
      duration_seconds: z.number().int().positive().nullable().optional(),
    }).parse(request.body);

    const key = evidenceObjectKey(schoolId, evidenceId, fileId, body.original_filename);

    try {
      // Same transaction: file row + draft→active + outbox evidence.file.registered
      // + worker job file.process (SEIP-WORKER-001 / events.yaml delivery rule).
      const file = await registerEvidenceFileWithWorkerJobs({
        id: fileId, evidenceId, storageUri: key, contentType: body.content_type,
        byteSize: BigInt(body.byte_size), checksumSha256: body.checksum_sha256,
        durationSeconds: body.duration_seconds ?? null, originalFilename: body.original_filename,
        schoolId, actorUserId: auth.userId, requestId: request.id,
      });

      await writeAuditEvent({
        schoolId, actorUserId: auth.userId, action: 'file_registered', entityType: 'EvidenceFile',
        entityId: file.id, after: file, requestId: request.id,
      });

      // Just registered → scan_status is still pending → download_url null (UPL-006).
      return serializeFile(file, s3, env.S3_BUCKET);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ApiError('UPL-004', 'Upload already completed for this file id');
      }
      throw e;
    }
  });
};
