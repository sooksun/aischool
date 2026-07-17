// Every error response — expected (ApiError) or not (anything else) — is shaped
// exactly like components.schemas.Error in openapi.yaml. Unexpected errors never
// leak internals (SEC-REPO / A05): the client gets SYS-001 + a request_id to quote
// back; the real detail goes to the server log only.
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from '@seip/backend-shared';
import { Prisma } from '@prisma/client';

export const errorHandlerPlugin: FastifyPluginAsync = fp(async (app) => {
  app.setErrorHandler((err, request, reply) => {
    const requestId = request.id;

    if (err instanceof ApiError) {
      reply.status(err.http).send(err.toBody(requestId));
      return;
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
