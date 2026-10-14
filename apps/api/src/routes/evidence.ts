// Evidence (person-owned, CCR-017) + resumable upload sessions + lazy download.
//
// Access to an item goes through authorizeEvidence (lib/evidence-access.ts): the
// owner from anywhere, a grant at the item's origin school, or a committee seat
// for the owner. Creates take an Idempotency-Key; updates and deletes need
// If-Match. Bytes never pass through this process (SEC-UPL-1): clients PUT to
// presigned URLs and the server completes multipart uploads from its own
// ListParts.
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listEvidence, withAreaScope, resolveAreaScope, createEvidence, getEvidenceDetail, updateEvidence, softDeleteEvidence,
  getEvidenceCategoryById, writeAuditEvent, aggregateScanStatus, getSchoolAreaId, acceptEvidenceByOwner, findOwnerFilesByChecksum,
  listEvaluateePersonIdsForCommitteeMember, getPersonnelInSchoolByPerson,
  openUploadSession, getUploadSession, claimUploadForCompletion, releaseUploadClaim,
  finishUpload, abortUploadSession, requestAnalysis,
} from '@seip/database';
import { ApiError, forbiddenAreaWrite, forbiddenRole } from '@seip/backend-shared';
import { requireCurrentSchool, type AuthedRequest } from '../plugins/auth.js';
import { resolveGrant } from '../lib/permission-guard.js';
import { authorizeEvidence, isOwner } from '../lib/evidence-access.js';
import { etag, idempotent, requireIfMatch, staleOrMissing } from '../lib/concurrency.js';
import {
  createS3Client, evidenceObjectKey, presignUpload, presignDownload, createMultipartUpload,
  presignUploadPart, listUploadedParts, completeMultipartFromListing, abortMultipartUpload, storedObjectSize,
} from '../lib/s3.js';
import type { Env } from '../env.js';

const SINGLE_PUT_MAX = 16 * 1024 * 1024;
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function serializeEvidence(e: {
  id: string; ownerPersonId: string; controllerAreaId: string | null; originSchoolId: string;
  uploadedByUserId: string; categoryId: string; kind: string; title: string; description: string | null;
  linkUrl: string | null; noteText: string | null; status: string; capturedAt: Date | null;
  performedFrom: Date | null; performedTo: Date | null; performedDateSource: string | null;
  academicYearBe: number | null; semester: number | null; containsLearners: string;
  clientUuid: string | null; version: number; createdAt: Date; updatedAt: Date;
  ownerAcceptedAt?: Date | null;
  files?: { scanStatus: string; mediaState?: string }[];
}) {
  return {
    id: e.id,
    owner_person_id: e.ownerPersonId,
    controller_area_id: e.controllerAreaId,
    origin_school_id: e.originSchoolId,
    uploaded_by_user_id: e.uploadedByUserId,
    category_id: e.categoryId,
    kind: e.kind,
    title: e.title,
    description: e.description,
    link_url: e.linkUrl,
    note_text: e.noteText,
    status: e.status,
    captured_at: e.capturedAt?.toISOString() ?? null,
    performed_from: dateOnly(e.performedFrom),
    performed_to: dateOnly(e.performedTo),
    performed_date_source: e.performedDateSource,
    academic_year_be: e.academicYearBe,
    semester: e.semester,
    contains_learners: e.containsLearners,
    client_uuid: e.clientUuid,
    version: e.version,
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
    owner_accepted_at: e.ownerAcceptedAt ? e.ownerAcceptedAt.toISOString() : null,
    scan_status: aggregateScanStatus(e.files ?? []),
  };
}

/** Metadata only — never calls object storage (CCR-010). storageUri never leaves
 * the server; clients get a URL from getEvidenceFileDownloadUrl. */
export function serializeFile(f: {
  id: string; evidenceId: string; contentType: string; byteSize: bigint; checksumSha256: string;
  durationSeconds: number | null; durationMs: number | null; originalFilename: string; scanStatus: string;
  uploadedAt: Date; role: string; parentFileId: string | null; sha256VerifiedAt: Date | null;
  pageCount: number | null; width: number | null; height: number | null; mediaState: string;
  duplicateOf?: { evidenceId: string } | null;
}) {
  return {
    id: f.id,
    evidence_id: f.evidenceId,
    role: f.role,
    parent_file_id: f.parentFileId,
    content_type: f.contentType,
    byte_size: Number(f.byteSize),
    checksum_sha256: f.checksumSha256,
    sha256_verified_at: f.sha256VerifiedAt?.toISOString() ?? null,
    duplicate_of_evidence_id: f.duplicateOf?.evidenceId ?? null,
    duration_seconds: f.durationSeconds,
    duration_ms: f.durationMs,
    page_count: f.pageCount,
    width: f.width,
    height: f.height,
    original_filename: f.originalFilename,
    scan_status: f.scanStatus,
    media_state: f.mediaState,
    download_url: null as string | null,
    uploaded_at: f.uploadedAt.toISOString(),
  };
}

export function serializeMapping(m: {
  id: string; evidenceId: string; indicatorId: string; frameworkVersionId: string; mappingSource: string;
  status: string; aiSuggestionId: string | null; note: string | null; ownerConfirmedByUserId: string;
  ownerConfirmedAt: Date; validatedByUserId: string | null; validatedAt: Date | null; validatorRole: string | null;
  returnNote: string | null; locatorSnapshot: unknown; version: number;
}) {
  return {
    id: m.id,
    evidence_id: m.evidenceId,
    indicator_id: m.indicatorId,
    framework_version_id: m.frameworkVersionId,
    mapping_source: m.mappingSource,
    status: m.status,
    ai_suggestion_id: m.aiSuggestionId,
    note: m.note,
    owner_confirmed_by_user_id: m.ownerConfirmedByUserId,
    owner_confirmed_at: m.ownerConfirmedAt.toISOString(),
    validated_by_user_id: m.validatedByUserId,
    validated_at: m.validatedAt?.toISOString() ?? null,
    validator_role: m.validatorRole,
    return_note: m.returnNote,
    locator_snapshot: (m.locatorSnapshot ?? null) as unknown[] | null,
    version: m.version,
  };
}

const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const evidenceFields = {
  title: z.string().min(1).max(300),
  description: z.string().max(2000).nullable().optional(),
  captured_at: z.string().datetime().nullable().optional(),
  // FR-015: a web address only — javascript:, data:, file: and the like are
  // refused, since the link is rendered as a clickable href.
  link_url: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'http(s) only').nullable().optional(),
  note_text: z.string().max(10000).nullable().optional(),
  performed_from: optDate,
  performed_to: optDate,
  academic_year_be: z.number().int().min(2560).max(2600).nullable().optional(),
  semester: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  contains_learners: z.enum(['unknown', 'yes', 'no']).optional(),
};
const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

export const evidenceRoutes: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const s3 = createS3Client(env);

  // CCR-026 / FR-012: before any bytes move, the client asks whether these exact
  // bytes are already in the caller's own portfolio.
  app.get('/me/files/duplicates', { config: { operationId: 'findMyDuplicateFiles' } }, async (request) => {
    const auth = request.auth!;
    const { checksum_sha256 } = z.object({ checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.query);
    if (!auth.personId) return [];
    const rows = await findOwnerFilesByChecksum(auth.personId, checksum_sha256);
    return rows.map((r) => ({ evidence_id: r.evidenceId, file_id: r.fileId, title: r.title, uploaded_at: r.uploadedAt.toISOString() }));
  });

  app.get('/evidence', { config: { operationId: 'listEvidence' } }, async (request) => {
    const auth = request.auth!;
    const q = z.object({
      owner_person_id: z.string().uuid().optional(),
      category_id: z.string().uuid().optional(),
      status: z.enum(['draft', 'active', 'archived', 'rejected']).optional(),
      mapped_to_indicator_id: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query);

    // Scope comes from the grant, never from the client alone. 'own' lists the
    // caller's portfolio wherever it was created; 'school' / 'area-r' the items
    // that originated in the current school; 'committee' the evaluatees' items.
    // No person → DENY, never an absent filter (2026-07-18 audit: an undefined
    // owner filter silently widened 'own' to the whole school).
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('listEvidence', auth, schoolId);
    const scope: { originSchoolId?: string; ownerPersonId?: string; ownerPersonIdIn?: string[] } = {};
    if (grant === 'own') {
      if (!auth.personId) throw new ApiError('PERM-001', 'own-scoped role has no person record');
      if (q.owner_person_id && q.owner_person_id !== auth.personId) {
        throw new ApiError('PERM-001', "own-scoped role may not list another person's evidence");
      }
      scope.ownerPersonId = auth.personId;
    } else if (grant === 'committee') {
      const persons = await listEvaluateePersonIdsForCommitteeMember(auth.userId);
      if (q.owner_person_id) {
        if (!persons.includes(q.owner_person_id)) throw new ApiError('PERM-001', 'Not a committee member for this person');
        scope.ownerPersonId = q.owner_person_id;
      } else {
        scope.ownerPersonIdIn = persons;
      }
    } else {
      scope.originSchoolId = schoolId;
      scope.ownerPersonId = q.owner_person_id;
    }

    // The filter above is the authorization; withAreaScope is the RLS backstop
    // behind it (ADR-0019) — a filter bug here still cannot list another สพท.
    const areaScope = await resolveAreaScope({
      userId: auth.userId, personId: auth.personId,
      schoolIds: [...auth.tenancy.schoolRoles.keys()], areaIds: [...auth.tenancy.areaRoles.keys()],
    });
    const { items, total } = await withAreaScope(areaScope, (tx) => listEvidence({
      ...scope,
      categoryId: q.category_id,
      status: q.status,
      mappedToIndicatorId: q.mapped_to_indicator_id,
      page: q.page,
      pageSize: q.page_size,
    }, tx));
    return { items: items.map(serializeEvidence), meta: { page: q.page, page_size: q.page_size, total } };
  });

  app.post('/evidence', { config: { operationId: 'createEvidence' } }, async (request, reply) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('createEvidence', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const body = z.object({
      ...evidenceFields,
      owner_person_id: z.string().uuid().nullable().optional(),
      category_id: z.string().uuid(),
      kind: z.enum(['file', 'link', 'note']),
      client_uuid: z.string().uuid(),
    }).parse(request.body);

    if (body.kind === 'link' && !body.link_url) throw new ApiError('VAL-002', 'link_url is required for kind=link', [{ field: 'link_url', issue: 'required' }]);
    if (body.kind === 'note' && !body.note_text) throw new ApiError('VAL-002', 'note_text is required for kind=note', [{ field: 'note_text', issue: 'required' }]);
    if (body.performed_from && body.performed_to && body.performed_from > body.performed_to) {
      throw new ApiError('VAL-002', 'performed_from is after performed_to', [{ field: 'performed_to', issue: 'before performed_from' }]);
    }

    // Owner: the caller, unless a school-scoped admin creates on behalf of a
    // person who is staff at this school.
    let ownerPersonId = body.owner_person_id ?? auth.personId;
    if (!ownerPersonId) throw new ApiError('VAL-002', 'owner_person_id is required when the caller has no person record');
    if (ownerPersonId !== auth.personId) {
      if (grant === 'own') throw new ApiError('PERM-001', 'own-scoped role may only create evidence for themselves');
      const staff = await getPersonnelInSchoolByPerson(schoolId, ownerPersonId);
      if (!staff) throw new ApiError('VAL-002', 'owner_person_id is not staff at this school');
      ownerPersonId = staff.personId;
    }

    const category = await getEvidenceCategoryById(body.category_id);
    if (!category) throw new ApiError('VAL-002', 'Unknown category_id');

    await idempotent(request, reply, 'createEvidence', async () => {
      const { row, replayed } = await createEvidence({
        ownerPersonId: ownerPersonId!,
        controllerAreaId: await getSchoolAreaId(schoolId),
        originSchoolId: schoolId,
        uploadedByUserId: auth.userId,
        // CCR-024: an item uploaded for someone else counts once its owner accepts it.
        ownerAccepted: ownerPersonId === auth.personId,
        categoryId: body.category_id,
        kind: body.kind,
        title: body.title,
        description: body.description ?? null,
        linkUrl: body.link_url ?? null,
        noteText: body.note_text ?? null,
        capturedAt: toDate(body.captured_at) ?? null,
        performedFrom: toDate(body.performed_from) ?? null,
        performedTo: toDate(body.performed_to) ?? null,
        academicYearBe: body.academic_year_be ?? null,
        semester: body.semester ?? null,
        containsLearners: body.contains_learners,
        clientUuid: body.client_uuid,
      });
      if (!replayed) {
        // P3: a link or note has nothing to scan, so its analysis starts now.
        if (row.kind !== 'file') await requestAnalysis(row.id, null);
        await writeAuditEvent({
          schoolId, actorUserId: auth.userId, action: 'created', entityType: 'Evidence',
          entityId: row.id, after: row, requestId: request.id,
        });
      }
      return { status: replayed ? 200 : 201, body: serializeEvidence(row), headers: { ETag: etag(row.version) } };
    });
  });

  app.get('/evidence/:evidenceId', { config: { operationId: 'getEvidence' } }, async (request, reply) => {
    const auth = request.auth!;
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const detail = await getEvidenceDetail(evidenceId);
    if (!detail) throw new ApiError('RES-001', 'Evidence not found');
    await authorizeEvidence('getEvidence', auth, detail);

    reply.header('ETag', etag(detail.version));
    return {
      ...serializeEvidence(detail),
      files: detail.files.map(serializeFile),
      mappings: detail.mappings.map(serializeMapping),
    };
  });

  app.patch('/evidence/:evidenceId', { config: { operationId: 'updateEvidence' } }, async (request, reply) => {
    const auth = request.auth!;
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const existing = await getEvidenceDetail(evidenceId);
    if (!existing) throw new ApiError('RES-001', 'Evidence not found');
    const grant = await authorizeEvidence('updateEvidence', auth, existing);
    if (grant === 'area-r') throw forbiddenAreaWrite();
    const expectedVersion = requireIfMatch(request);

    const patch = z.object({
      title: evidenceFields.title.optional(),
      description: evidenceFields.description,
      status: z.enum(['draft', 'active', 'archived', 'rejected']).optional(),
      captured_at: evidenceFields.captured_at,
      link_url: evidenceFields.link_url,
      note_text: evidenceFields.note_text,
      performed_from: evidenceFields.performed_from,
      performed_to: evidenceFields.performed_to,
      performed_date_source: z.enum(['teacher', 'exif', 'ai_suggested_confirmed']).nullable().optional(),
      academic_year_be: evidenceFields.academic_year_be,
      semester: evidenceFields.semester,
      contains_learners: evidenceFields.contains_learners,
      origin_school_id: z.string().uuid().optional(),
    }).refine((p) => Object.keys(p).length > 0, 'at least one field required').parse(request.body);

    // CCR-024 / FR-019: the owner moves the item to another of their current
    // schools, within the same controller (another สพท. is ADR-0015 §5).
    const moving = patch.origin_school_id !== undefined && patch.origin_school_id !== existing.originSchoolId;
    if (moving) {
      if (!isOwner(auth, existing)) throw new ApiError('PERM-001', 'Only the owner moves an item to another school');
      if (!auth.tenancy.schoolRoles.has(patch.origin_school_id!)) {
        throw new ApiError('VAL-002', 'origin_school_id must be a school where you are a current member');
      }
      if ((await getSchoolAreaId(patch.origin_school_id!)) !== existing.controllerAreaId) {
        throw new ApiError('VAL-002', 'Moving to a school in another สพท. needs a transfer between controllers');
      }
    }

    const res = await updateEvidence(evidenceId, expectedVersion, {
      title: patch.title,
      description: patch.description,
      status: patch.status,
      capturedAt: toDate(patch.captured_at),
      linkUrl: patch.link_url,
      noteText: patch.note_text,
      performedFrom: toDate(patch.performed_from),
      performedTo: toDate(patch.performed_to),
      performedDateSource: patch.performed_date_source,
      academicYearBe: patch.academic_year_be,
      semester: patch.semester,
      containsLearners: patch.contains_learners,
      originSchoolId: moving ? patch.origin_school_id : undefined,
    });
    if (!res.ok) throw staleOrMissing(res.reason, 'Evidence');

    await writeAuditEvent({
      schoolId: existing.originSchoolId, actorUserId: auth.userId, action: moving ? 'moved' : 'updated', entityType: 'Evidence',
      entityId: evidenceId, before: existing, after: res.row, requestId: request.id,
    });
    reply.header('ETag', etag(res.row.version));
    return serializeEvidence(res.row);
  });

  // CCR-024: the owner accepts an item a school admin uploaded on their behalf.
  app.post('/evidence/:evidenceId/accept', { config: { operationId: 'acceptEvidence' } }, async (request) => {
    const auth = request.auth!;
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const existing = await getEvidenceDetail(evidenceId);
    if (!existing) throw new ApiError('RES-001', 'Evidence not found');
    await authorizeEvidence('acceptEvidence', auth, existing);
    if (!isOwner(auth, existing)) throw forbiddenRole();
    const row = (await acceptEvidenceByOwner(evidenceId))!;
    if (!existing.ownerAcceptedAt) {
      await writeAuditEvent({
        schoolId: existing.originSchoolId, actorUserId: auth.userId, action: 'owner_accepted', entityType: 'Evidence',
        entityId: evidenceId, requestId: request.id,
      });
    }
    return serializeEvidence(row);
  });

  app.delete('/evidence/:evidenceId', { config: { operationId: 'deleteEvidence' } }, async (request, reply) => {
    const auth = request.auth!;
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const existing = await getEvidenceDetail(evidenceId);
    if (!existing) throw new ApiError('RES-001', 'Evidence not found');
    const grant = await authorizeEvidence('deleteEvidence', auth, existing);
    if (grant === 'area-r') throw forbiddenAreaWrite();
    const expectedVersion = requireIfMatch(request);

    const res = await softDeleteEvidence(evidenceId, expectedVersion);
    if (!res.ok) throw staleOrMissing(res.reason, 'Evidence');

    await writeAuditEvent({
      schoolId: existing.originSchoolId, actorUserId: auth.userId, action: 'soft_deleted', entityType: 'Evidence',
      entityId: evidenceId, before: existing, requestId: request.id,
    });
    reply.status(204).send();
  });

  // ── upload sessions (ADR-0016 §5) ──

  function serializeUpload(u: {
    id: string; evidenceId: string; fileId: string; protocol: string; byteSize: bigint; partSize: number;
    partCount: number; status: string; expiresAt: Date;
  }, extra: { singlePut?: { url: string; headers: Record<string, string>; expiresAt: Date } | null; partsReceived: number[] }) {
    return {
      id: u.id, evidence_id: u.evidenceId, file_id: u.fileId, protocol: u.protocol,
      byte_size: Number(u.byteSize), part_size: u.partSize, part_count: u.partCount,
      status: u.status, expires_at: u.expiresAt.toISOString(),
      single_put: extra.singlePut
        ? { url: extra.singlePut.url, method: 'PUT', headers: extra.singlePut.headers, expires_at: extra.singlePut.expiresAt.toISOString() }
        : null,
      parts_received: extra.partsReceived,
    };
  }

  async function loadUpload(operationId: string, auth: AuthedRequest, uploadId: string) {
    const session = await getUploadSession(uploadId);
    if (!session || session.evidence.deletedAt) throw new ApiError('RES-001', 'Upload session not found');
    const grant = await authorizeEvidence(operationId, auth, session.evidence);
    if (grant === 'area-r') throw forbiddenAreaWrite();
    return session;
  }

  app.post('/uploads', { config: { operationId: 'createUpload' } }, async (request, reply) => {
    const auth = request.auth!;
    const body = z.object({
      evidence_id: z.string().uuid(),
      filename: z.string().min(1).max(255),
      content_type: z.string().min(1),
      byte_size: z.number().int().positive(),
      checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      duration_ms: z.number().int().nonnegative().nullable().optional(),
    }).parse(request.body);

    const evidence = await getEvidenceDetail(body.evidence_id);
    if (!evidence) throw new ApiError('RES-001', 'Evidence not found');
    const grant = await authorizeEvidence('createUpload', auth, evidence);
    if (grant === 'area-r') throw forbiddenAreaWrite();
    if (evidence.kind !== 'file') throw new ApiError('VAL-002', `kind=${evidence.kind} evidence has nothing to upload`);

    const category = await getEvidenceCategoryById(evidence.categoryId);
    if (!category) throw new ApiError('SYS-001', "evidence's own category vanished");
    const allowed = category.allowedMimeTypes ?? [];
    if (!allowed.includes(body.content_type)) {
      throw new ApiError('UPL-001', `content type ${body.content_type} not allowed for category ${category.code}`,
        [{ field: 'content_type', issue: `must be one of: ${allowed.join(', ')}` }]);
    }
    if (category.maxByteSize && BigInt(body.byte_size) > category.maxByteSize) {
      throw new ApiError('UPL-002', `file exceeds ${category.maxByteSize} bytes for category ${category.code}`);
    }
    // Duration cap (ว9 inspiration video ≤ 600 s): a capped video must declare its
    // duration so the cap is checked before bytes move (2026-07-18 audit — an
    // absent duration used to skip the rule entirely). The worker's probe is the
    // backstop after upload.
    if (category.maxDurationSeconds && body.content_type.startsWith('video/')) {
      if (body.duration_ms == null) {
        throw new ApiError('VAL-002', `duration_ms is required for category ${category.code} (max ${category.maxDurationSeconds}s)`,
          [{ field: 'duration_ms', issue: 'required for a duration-capped category' }]);
      }
      if (body.duration_ms > category.maxDurationSeconds * 1000) {
        throw new ApiError('UPL-003', `duration ${Math.round(body.duration_ms / 1000)}s exceeds ${category.maxDurationSeconds}s for category ${category.code}`);
      }
    }

    await idempotent(request, reply, 'createUpload', async () => {
      const fileId = randomUUID();
      const key = evidenceObjectKey(evidence.originSchoolId, evidence.id, fileId, body.filename);
      const protocol = body.byte_size <= SINGLE_PUT_MAX ? 'single_put' : 's3_multipart';
      const s3UploadId = protocol === 's3_multipart'
        ? await createMultipartUpload(s3, env.S3_BUCKET, key, body.content_type)
        : null;
      const session = await openUploadSession({
        evidenceId: evidence.id, fileId, storageUri: key, contentType: body.content_type,
        byteSize: BigInt(body.byte_size), checksumSha256: body.checksum_sha256, originalFilename: body.filename,
        durationMs: body.duration_ms ?? null, protocol, s3UploadId, createdByUserId: auth.userId,
      });
      let singlePut = null;
      if (protocol === 'single_put') {
        const p = await presignUpload(s3, env.S3_BUCKET, key, body.content_type, body.byte_size);
        singlePut = { url: p.uploadUrl, headers: { 'Content-Type': body.content_type }, expiresAt: p.expiresAt };
      }
      return { status: 201, body: serializeUpload(session, { singlePut, partsReceived: [] }) };
    });
  });

  app.get('/uploads/:uploadId', { config: { operationId: 'getUpload' } }, async (request) => {
    const auth = request.auth!;
    const { uploadId } = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const session = await loadUpload('getUpload', auth, uploadId);
    let partsReceived: number[] = [];
    let singlePut = null;
    if (session.status === 'open') {
      if (session.protocol === 's3_multipart' && session.s3UploadId) {
        partsReceived = (await listUploadedParts(s3, env.S3_BUCKET, session.file.storageUri, session.s3UploadId)).map((p) => p.PartNumber);
      } else if (session.protocol === 'single_put') {
        // A resumed single PUT just gets a fresh URL — the whole file is one part.
        const p = await presignUpload(s3, env.S3_BUCKET, session.file.storageUri, session.file.contentType, Number(session.byteSize));
        singlePut = { url: p.uploadUrl, headers: { 'Content-Type': session.file.contentType }, expiresAt: p.expiresAt };
      }
    }
    return serializeUpload(session, { singlePut, partsReceived });
  });

  app.post('/uploads/:uploadId/part-urls', { config: { operationId: 'signUploadParts' } }, async (request) => {
    const auth = request.auth!;
    const { uploadId } = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      part_numbers: z.array(z.number().int().min(1).max(10000)).min(1).max(100),
      checksums_sha256: z.array(z.string().regex(/^[A-Za-z0-9+/]{43}=$/)).min(1).max(100).nullable().optional(),
    }).parse(request.body);
    if (body.checksums_sha256 && body.checksums_sha256.length !== body.part_numbers.length) {
      throw new ApiError('VAL-002', 'checksums_sha256 must align with part_numbers', [{ field: 'checksums_sha256', issue: 'length mismatch' }]);
    }

    const session = await loadUpload('signUploadParts', auth, uploadId);
    if (session.status !== 'open' || session.expiresAt <= new Date()) throw new ApiError('UPL-007', 'Upload session is not open');
    if (session.protocol !== 's3_multipart' || !session.s3UploadId) {
      throw new ApiError('VAL-002', 'single_put sessions have no parts — use single_put from createUpload/getUpload');
    }
    const outOfRange = body.part_numbers.filter((n) => n > session.partCount);
    if (outOfRange.length) throw new ApiError('VAL-002', `part numbers beyond part_count ${session.partCount}: ${outOfRange.join(', ')}`);

    const parts = await Promise.all(body.part_numbers.map(async (n, i) => {
      const p = await presignUploadPart(s3, env.S3_BUCKET, session.file.storageUri, session.s3UploadId!, n, body.checksums_sha256?.[i]);
      return { part_number: n, request: { url: p.url, method: 'PUT', headers: p.headers, expires_at: p.expiresAt.toISOString() } };
    }));
    return { parts };
  });

  app.post('/uploads/:uploadId/complete', { config: { operationId: 'completeUpload' } }, async (request) => {
    const auth = request.auth!;
    const { uploadId } = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const body = z.object({ part_count: z.number().int().min(1) }).parse(request.body);
    const session = await loadUpload('completeUpload', auth, uploadId);
    if (body.part_count !== session.partCount) {
      throw new ApiError('UPL-008', `part_count ${body.part_count} does not match the session's ${session.partCount}`);
    }
    if (!(await claimUploadForCompletion(uploadId))) throw new ApiError('UPL-007', 'Upload session is not open');

    try {
      if (session.protocol === 's3_multipart' && session.s3UploadId) {
        // The server lists what arrived and completes from that — clients never
        // supply ETags (ADR-0016 §5).
        const parts = await listUploadedParts(s3, env.S3_BUCKET, session.file.storageUri, session.s3UploadId);
        const have = new Set(parts.map((p) => p.PartNumber));
        const missing = Array.from({ length: session.partCount }, (_, i) => i + 1).filter((n) => !have.has(n));
        if (missing.length) {
          throw new ApiError('UPL-008', `parts missing: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`);
        }
        const total = parts.reduce((n, p) => n + p.Size, 0);
        if (BigInt(total) !== session.byteSize) {
          throw new ApiError('UPL-008', `stored parts total ${total} bytes, the session declared ${session.byteSize}`);
        }
        await completeMultipartFromListing(s3, env.S3_BUCKET, session.file.storageUri, session.s3UploadId, parts);
      } else {
        const size = await storedObjectSize(s3, env.S3_BUCKET, session.file.storageUri);
        if (size === null) throw new ApiError('UPL-008', 'nothing was uploaded for this session');
      }
    } catch (e) {
      await releaseUploadClaim(uploadId);
      throw e;
    }

    const file = await finishUpload({
      uploadId, fileId: session.fileId, evidenceId: session.evidenceId, originSchoolId: session.evidence.originSchoolId,
      contentType: session.file.contentType, byteSize: session.byteSize, actorUserId: auth.userId, requestId: request.id,
    });
    await writeAuditEvent({
      schoolId: session.evidence.originSchoolId, actorUserId: auth.userId, action: 'file_registered', entityType: 'EvidenceFile',
      entityId: file.id, after: file, requestId: request.id,
    });
    return serializeFile(file);
  });

  app.delete('/uploads/:uploadId', { config: { operationId: 'abortUpload' } }, async (request, reply) => {
    const auth = request.auth!;
    const { uploadId } = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const session = await loadUpload('abortUpload', auth, uploadId);
    if (session.status !== 'open') throw new ApiError('UPL-007', 'Upload session is not open');
    if (session.protocol === 's3_multipart' && session.s3UploadId) {
      await abortMultipartUpload(s3, env.S3_BUCKET, session.file.storageUri, session.s3UploadId).catch(() => {
        // Already gone on the store side; the session still ends here, and the
        // bucket lifecycle rule aborts strays after 7 days (ADR-0016 §5).
      });
    }
    if (!(await abortUploadSession(uploadId))) throw new ApiError('UPL-007', 'Upload session is not open');
    reply.status(204).send();
  });

  // CCR-010: the only endpoint that presigns a download for an evidence file.
  app.get('/evidence/:evidenceId/files/:fileId/download-url', {
    config: { operationId: 'getEvidenceFileDownloadUrl' },
  }, async (request) => {
    const auth = request.auth!;
    const { evidenceId, fileId } = z.object({ evidenceId: z.string().uuid(), fileId: z.string().uuid() }).parse(request.params);
    const detail = await getEvidenceDetail(evidenceId);
    if (!detail) throw new ApiError('RES-001', 'Evidence not found');
    await authorizeEvidence('getEvidenceFileDownloadUrl', auth, detail);

    const file = detail.files.find((f) => f.id === fileId);
    if (!file) throw new ApiError('RES-001', 'Evidence file not found');
    // CCR-012: 'unscanned' is served like 'clean' (disclosed, not enforced);
    // 'sanitised' serves its CDR rendition (ADR-0018). 'pending' and 'blocked'
    // stay refused, and so does anything still uploading.
    if (file.mediaState === 'uploading' || !['clean', 'unscanned', 'sanitised'].includes(file.scanStatus)) {
      throw new ApiError('UPL-006', `File is not available for download (scan_status=${file.scanStatus})`);
    }
    const { downloadUrl, expiresAt } = await presignDownload(s3, env.S3_BUCKET, file.storageUri, file.originalFilename);
    return { download_url: downloadUrl, expires_at: expiresAt.toISOString() };
  });

};
