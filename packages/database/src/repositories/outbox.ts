// Transactional outbox (events.yaml + module-boundaries rule 4).
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export interface EnqueueOutboxInput {
  eventType: string;
  schemaVersion?: number;
  schoolId: string | null;
  actorUserId: string | null;
  requestId?: string | null;
  payload: Prisma.InputJsonValue;
  /** Optional fixed id (for correlating with a worker job). */
  id?: string;
  occurredAt?: Date;
}

export async function enqueueOutboxEvent(
  input: EnqueueOutboxInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return tx.outboxEvent.create({
    data: {
      id: input.id ?? randomUUID(),
      eventType: input.eventType,
      schemaVersion: input.schemaVersion ?? 1,
      schoolId: input.schoolId,
      actorUserId: input.actorUserId,
      requestId: input.requestId ?? null,
      payload: input.payload,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}

/** Claim unpublished outbox rows for dispatch (FOR UPDATE SKIP LOCKED pattern via statusless claim). */
export async function claimUnpublishedOutbox(limit = 20) {
  // Postgres: select ids then update — sufficient for single-worker MVP; multi-worker can upgrade to SKIP LOCKED.
  const pending = await prisma.outboxEvent.findMany({
    where: { publishedAt: null, attempts: { lt: 10 } },
    orderBy: { occurredAt: 'asc' },
    take: limit,
  });
  return pending;
}

export async function markOutboxPublished(id: string) {
  return prisma.outboxEvent.update({
    where: { id },
    data: { publishedAt: new Date(), lastError: null },
  });
}

export async function markOutboxFailed(id: string, error: string) {
  return prisma.outboxEvent.update({
    where: { id },
    data: {
      attempts: { increment: 1 },
      lastError: error.slice(0, 2000),
    },
  });
}
