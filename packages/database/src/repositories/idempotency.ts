// Idempotency-Key replay store (CCR-017). The first response to (actor, key) is
// kept for 24 h; a retry with the same request body replays it, a different body
// under the same key is IDEMP-001. This is what lets an offline client resend
// blindly after a lost response without creating a second evidence, mapping or
// upload session.
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function hashRequest(operationId: string, body: unknown, params: unknown): string {
  return createHash('sha256').update(JSON.stringify([operationId, params ?? null, body ?? null])).digest('hex');
}

export type IdempotencyLookup =
  | { kind: 'miss' }
  | { kind: 'replay'; statusCode: number; response: unknown }
  | { kind: 'conflict' };

export async function lookupIdempotencyKey(actorUserId: string, key: string, requestHash: string): Promise<IdempotencyLookup> {
  const row = await prisma.idempotencyKey.findUnique({ where: { actorUserId_key: { actorUserId, key } } });
  if (!row || row.expiresAt <= new Date()) return { kind: 'miss' };
  if (row.requestHash !== requestHash) return { kind: 'conflict' };
  return { kind: 'replay', statusCode: row.statusCode, response: row.response };
}

/** Record the first successful response. A concurrent first request with the same
 * key loses the race quietly (the unique key already holds the winner's answer). */
export async function storeIdempotentResponse(input: {
  actorUserId: string; key: string; operationId: string; requestHash: string; statusCode: number; response: Prisma.InputJsonValue;
}) {
  await prisma.idempotencyKey.upsert({
    where: { actorUserId_key: { actorUserId: input.actorUserId, key: input.key } },
    create: { ...input, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) },
    update: {},
  });
}

export async function purgeExpiredIdempotencyKeys(): Promise<number> {
  const res = await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return res.count;
}
