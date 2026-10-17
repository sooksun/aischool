// If-Match and Idempotency-Key (CCR-017).
//
// If-Match carries the `version` the client last read, as an ETag (`"7"`). A
// write without it is refused (428 RES-005) rather than allowed to clobber a
// change made on another device; a stale one is 412 RES-004.
//
// Idempotency-Key makes a create safe to retry blind: the first response is kept
// for 24 h and replayed for the same body; a different body under the same key is
// IDEMP-001. Only successful (2xx) responses are stored — a failed attempt may be
// retried and is then a new attempt.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '@seip/backend-shared';
import { hashRequest, lookupIdempotencyKey, storeIdempotentResponse } from '@seip/database';
import { z } from 'zod';

export function etag(version: number): string {
  return `"${version}"`;
}

export function requireIfMatch(request: FastifyRequest): number {
  const raw = request.headers['if-match'];
  if (raw === undefined || raw === '') throw new ApiError('RES-005', 'If-Match is required for this write');
  const value = Array.isArray(raw) ? raw[0] : raw;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(value.trim());
  if (!m) throw new ApiError('VAL-001', 'If-Match must be the resource version as an ETag, e.g. "3"', [{ field: 'If-Match', issue: 'malformed' }]);
  return Number(m[1]);
}

export function staleOrMissing(reason: 'missing' | 'stale', what: string): ApiError {
  return reason === 'stale'
    ? new ApiError('RES-004', `${what} changed since it was read — re-read and retry`)
    : new ApiError('RES-001', `${what} not found`);
}

const IdemKey = z.string().uuid();

/**
 * Runs `handler` at most once per (caller, Idempotency-Key). `handler` returns the
 * status and body; this sends it (and records it), or replays the recorded one.
 */
export async function idempotent(
  request: FastifyRequest,
  reply: FastifyReply,
  operationId: string,
  handler: () => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>,
): Promise<void> {
  const raw = request.headers['idempotency-key'];
  const parsed = IdemKey.safeParse(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed.success) {
    throw new ApiError('VAL-001', 'Idempotency-Key header (a UUID) is required', [{ field: 'Idempotency-Key', issue: 'required uuid' }]);
  }
  const actorUserId = request.auth!.userId;
  const requestHash = hashRequest(operationId, request.body, request.params);
  const hit = await lookupIdempotencyKey(actorUserId, parsed.data, requestHash);
  if (hit.kind === 'conflict') throw new ApiError('IDEMP-001', 'Idempotency-Key was already used with a different request');
  if (hit.kind === 'replay') {
    // A replay of a create answers 200, not 201: nothing was created this time.
    reply.status(hit.statusCode === 201 ? 200 : hit.statusCode).header('Idempotent-Replay', 'true').send(hit.response);
    return;
  }
  const result = await handler();
  if (result.status >= 200 && result.status < 300) {
    await storeIdempotentResponse({
      actorUserId, key: parsed.data, operationId, requestHash,
      statusCode: result.status, response: result.body as never,
    });
  }
  for (const [k, v] of Object.entries(result.headers ?? {})) reply.header(k, v);
  reply.status(result.status).send(result.body);
}
