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

/**
 * Claim unpublished outbox rows for dispatch, one dispatcher at a time per row.
 *
 * The CAS gate is the `attempts` value read with the candidate — classic
 * optimistic concurrency. A losing racer's WHERE no longer matches (the winner
 * already incremented), so its updateMany affects 0 rows and it skips that row.
 *
 * The previous version gated on `publishedAt: null` alone while only
 * incrementing `attempts`. Nothing in the claim changed the column being tested,
 * so `publishedAt` was still null for the second racer: BOTH got count === 1 and
 * both claimed the same row. The comment asserted the guarantee; the code never
 * implemented it (2026-07-18 audit). Masked so far only because a single worker
 * process runs the loop.
 *
 * WorkerJob does this with a real state transition (pending → running, jobs.ts).
 * OutboxEvent has no status column, so `attempts` carries the CAS — one increment
 * per claim, which is also what an attempts counter should mean. markOutboxFailed
 * therefore does NOT increment again; the claim already counted the try.
 */
export async function claimUnpublishedOutbox(limit = 20) {
  const candidates = await prisma.outboxEvent.findMany({
    where: { publishedAt: null, attempts: { lt: 10 } },
    orderBy: { occurredAt: 'asc' },
    take: limit,
  });

  const claimed = [];
  for (const row of candidates) {
    const result = await prisma.outboxEvent.updateMany({
      where: { id: row.id, publishedAt: null, attempts: row.attempts },
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

/** Records why a dispatch failed. Deliberately does NOT touch `attempts` —
 * claimUnpublishedOutbox already counted this try when it took the row, and
 * incrementing here too burned the `attempts < 10` retry budget at 2 per cycle,
 * retiring an event after 5 real attempts instead of 10. Mirrors markJobFailed,
 * which leaves the counter to claimPendingJobs for the same reason. */
export async function markOutboxFailed(id: string, error: string) {
  return prisma.outboxEvent.update({
    where: { id },
    data: { lastError: error.slice(0, 2000) },
  });
}
