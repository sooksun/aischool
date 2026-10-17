// Every error response — expected (ApiError) or not (anything else) — is shaped
// exactly like components.schemas.Error in openapi.yaml. Unexpected errors never
// leak internals (SEC-REPO / A05): the client gets SYS-001 + a request_id to quote
// back; the real detail goes to the server log only.
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from '@seip/backend-shared';
import { writeAuditEvent } from '@seip/database';
import { Prisma } from '@prisma/client';

/**
 * Denials that permissions.yaml's notes promise an audit trail for: "Every deny
 * path emits an AuditEvent with action=access_denied when the request carried a
 * valid identity" (FR-095). PERM-* (role / tenancy / committee), AUTH-006 (step-up)
 * and RES-001 — which is also how a cross-tenant read is answered, so it is the
 * probing signal that matters most, even though it cannot be told apart from a
 * genuinely missing id. Requests that never authenticated have no actor and are
 * not audited here (the login limiter and the access log cover them).
 */
const AUDITED_DENIALS = /^(PERM-\d{3}|AUTH-006|RES-001)$/;

export const errorHandlerPlugin: FastifyPluginAsync = fp(async (app) => {
  app.setErrorHandler(async (err, request, reply) => {
    const requestId = request.id;

    if (err instanceof ApiError) {
      const auth = request.auth;
      if (auth && AUDITED_DENIALS.test(err.code)) {
        const operationId = request.routeOptions?.config?.operationId ?? 'unknown';
        // Best effort: a failed audit write must not turn a 403 into a 500.
        await writeAuditEvent({
          schoolId: auth.currentSchoolId, actorUserId: auth.userId, action: 'access_denied',
          entityType: 'Request', entityId: operationId,
          after: { operationId, code: err.code, method: request.method, route: request.routeOptions?.url ?? null },
          requestId,
        }).catch((e) => request.log.warn({ err: e }, 'access_denied audit write failed'));
      }
      return reply.status(err.http).send(err.toBody(requestId));
    }

    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ field: i.path.join('.') || '(body)', issue: i.message }));
      reply.status(400).send({ code: 'VAL-001', message: 'Malformed request body or query', details, request_id: requestId });
      return;
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 unique-violation surfaces here only if a route forgot to catch it
      // itself (routes that expect a specific conflict — UPL-004, MAP-001 — catch
      // P2002 locally to return the precise code; this is the generic fallback).
      if (err.code === 'P2002') {
        reply.status(409).send({ code: 'RES-002', message: 'Concurrent modification or duplicate', request_id: requestId });
        return;
      }
    }

    // Fastify's own validation errors (route schema) carry a `validation` array.
    const asRecord = err as { validation?: unknown; message?: unknown };
    if (asRecord.validation) {
      const message = typeof asRecord.message === 'string' ? asRecord.message : 'Invalid request';
      reply.status(400).send({ code: 'VAL-001', message, request_id: requestId });
      return;
    }

    request.log.error({ err, requestId }, 'unhandled error');
    reply.status(500).send({ code: 'SYS-001', message: 'Unexpected server error', request_id: requestId });
  });
});
