// P5 exports (ADR-0017). portfolio_portable ships in this slice; dpa_pack and
// pa2_workbook come with their rules data and answer VAL-002 until then.
//   createExport          own (person_id = the caller) or school (a staff member
//                         of a school where the caller holds a school grant —
//                         permissions min_acr other_person: 2)
//   listExports           the caller's own, plus those requested at schools where
//                         they hold a school grant
//   getExport / download  the same routes; anyone else gets RES-001
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  queueExport, getExportById, listExportsFor, listActiveSchoolIdsOfPerson, writeAuditEvent,
} from '@seip/database';
import { ApiError } from '@seip/backend-shared';
import type { Env } from '../env.js';
import type { AuthedRequest } from '../plugins/auth.js';
import { requireCurrentSchool } from '../plugins/auth.js';
import { resolveGrant, requireAcr, requireAnyGrant } from '../lib/permission-guard.js';
import { ownGrant } from '../lib/evidence-access.js';
import { idempotent } from '../lib/concurrency.js';
import { createPresignClient, presignDownload } from '../lib/s3.js';

type ExportRow = NonNullable<Awaited<ReturnType<typeof getExportById>>>;

function serialize(e: ExportRow) {
  const expired = e.status === 'ready' && !!e.expiresAt && e.expiresAt < new Date();
  return {
    id: e.id,
    kind: e.kind,
    person_id: e.personId,
    status: expired ? 'expired' : e.status,
    preflight: (e.preflight ?? []) as unknown[],
    byte_size: e.byteSize === null ? null : Number(e.byteSize),
    sha256: e.sha256,
    expires_at: e.expiresAt?.toISOString() ?? null,
    created_at: e.createdAt.toISOString(),
  };
}

async function schoolGrantAt(op: string, auth: AuthedRequest, schoolId: string): Promise<boolean> {
  try {
    return (await resolveGrant(op, auth, schoolId)) === 'school';
  } catch {
    return false;
  }
}

/** The caller's own export, or one requested at a school where they hold a school grant. */
async function exportFor(op: string, auth: AuthedRequest, id: string): Promise<ExportRow> {
  // A role with no grant at all is PERM-001 before any lookup; past that, every
  // miss is RES-001 so another person's export never shows it exists.
  if (!ownGrant(op, auth)) requireAnyGrant(op, auth);
  const e = await getExportById(id);
  if (e && ((auth.personId === e.personId && ownGrant(op, auth)) || (await schoolGrantAt(op, auth, e.schoolId)))) return e;
  throw new ApiError('RES-001', 'Export not found');
}

export const exportRoutes: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const signer = createPresignClient(env);

  app.post('/exports', { config: { operationId: 'createExport' } }, async (request, reply) => {
    const auth = request.auth!;
    const body = z.object({
      kind: z.enum(['dpa_pack', 'pa2_workbook', 'portfolio_portable']),
      person_id: z.string().uuid().nullable().optional(),
      assignment_id: z.string().uuid().nullable().optional(),
      request_type: z.string().nullable().optional(),
      slot_assignments: z.array(z.object({ slot_code: z.string(), evidence_ids: z.array(z.string().uuid()) })).nullable().optional(),
    }).parse(request.body);
    const schoolId = requireCurrentSchool(auth);
    const personId = body.person_id ?? auth.personId;
    if (!personId) throw new ApiError('VAL-002', 'This account has no person to export', [{ field: 'person_id', issue: 'required' }]);

    if (personId === auth.personId) {
      if (!ownGrant('createExport', auth)) await resolveGrant('createExport', auth, schoolId); // PERM-001 without any grant
    } else {
      // Someone else's data: a school grant at a school where they are staff, then step-up.
      const theirSchools = await listActiveSchoolIdsOfPerson(personId);
      if (!theirSchools.includes(schoolId) || !(await schoolGrantAt('createExport', auth, schoolId))) {
        await resolveGrant('createExport', auth, schoolId); // PERM-001 for a role with no grant at all
        throw new ApiError('RES-001', 'Person not found');
      }
      requireAcr(auth, 'createExport', 'other_person');
    }
    if (body.kind !== 'portfolio_portable') {
      throw new ApiError('VAL-002', `${body.kind} is not available yet — its rules data is still being verified (ADR-0017)`, [{ field: 'kind', issue: 'not available' }]);
    }

    await idempotent(request, reply, 'createExport', async () => {
      const row = await queueExport({ kind: body.kind, personId, schoolId, requestedByUserId: auth.userId });
      if (personId !== auth.personId) {
        await writeAuditEvent({
          schoolId, actorUserId: auth.userId, action: 'export_requested', entityType: 'ExportPackage', entityId: row.id,
          after: { kind: row.kind, person_id: personId }, requestId: request.id,
        });
      }
      return { status: 202, body: serialize(row) };
    });
  });

  app.get('/exports', { config: { operationId: 'listExports' } }, async (request) => {
    const auth = request.auth!;
    const q = z.object({
      cursor: z.string().regex(/^\d+$/).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query);
    const schoolIds: string[] = [];
    for (const sid of auth.tenancy.schoolRoles.keys()) if (await schoolGrantAt('listExports', auth, sid)) schoolIds.push(sid);
    const own = ownGrant('listExports', auth) ? auth.personId : null;
    if (!own && schoolIds.length === 0) requireAnyGrant('listExports', auth); // PERM-001 with no grant anywhere
    const offset = q.cursor ? Number(q.cursor) : 0;
    const page = await listExportsFor(own, schoolIds, { offset, limit: q.limit });
    return { items: page.items.map(serialize), next_cursor: page.more ? String(offset + q.limit) : null };
  });

  app.get('/exports/:exportId', { config: { operationId: 'getExport' } }, async (request) => {
    const { exportId } = z.object({ exportId: z.string().uuid() }).parse(request.params);
    return serialize(await exportFor('getExport', request.auth!, exportId));
  });

  app.get('/exports/:exportId/download-url', { config: { operationId: 'getExportDownloadUrl' } }, async (request) => {
    const auth = request.auth!;
    const { exportId } = z.object({ exportId: z.string().uuid() }).parse(request.params);
    const e = await exportFor('getExportDownloadUrl', auth, exportId);
    if (e.status !== 'ready' || !e.storageUri || (e.expiresAt && e.expiresAt < new Date())) {
      throw new ApiError('EXP-002', 'Export not ready');
    }
    const name = `SEIP-portfolio-${e.createdAt.toISOString().slice(0, 10)}.zip`;
    const { downloadUrl, expiresAt } = await presignDownload(signer, env.S3_BUCKET, e.storageUri, name);
    if (e.personId !== auth.personId) {
      await writeAuditEvent({
        schoolId: e.schoolId, actorUserId: auth.userId, action: 'export_downloaded', entityType: 'ExportPackage', entityId: e.id,
        after: { person_id: e.personId }, requestId: request.id,
      });
    }
    return { download_url: downloadUrl, expires_at: expiresAt.toISOString() };
  });
};
