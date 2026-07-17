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

/** Claim unpublished outbox rows for dispatch. Same optimistic-CAS pattern as
 * jobs.ts's claimPendingJobs: select candidates, then a per-row conditional
 * updateMany (only succeeds if still unpublished) before treating a row as
 * claimed — a losing racer's updateMany affects 0 rows and the row is skipped,
 * rather than two concurrent dispatch passes both processing it. There's no
 * separate "claimed" flag on this table, so the claim reuses `attempts`
 * (already incremented on failure by markOutboxFailed) as the CAS gate — after
 * this change it also increments once per claim, which is the more standard
 * meaning for an attempts counter anyway. */
export async function claimUnpublishedOutbox(limit = 20) {
  const candidates = await prisma.outboxEvent.findMany({
    where: { publishedAt: null, attempts: { lt: 10 } },
    orderBy: { occurredAt: 'asc' },
    take: limit,
  });

  const claimed = [];
  for (const row of candidates) {
    const result = await prisma.outboxEvent.updateMany({
      where: { id: row.id, publishedAt: null },
      data: { attempts: { increment: 1 } },
    });
    if (result.count === 1) {
      claimed.push(row);
    }
  }
  return claimed;
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
