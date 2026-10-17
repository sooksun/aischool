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

/** How long a claimed event stays invisible to other dispatchers if the claimer
 * dies before publishing or failing it. */
const OUTBOX_LEASE_SECONDS = 60;

type OutboxRow = Awaited<ReturnType<typeof prisma.outboxEvent.findMany>>[number];

/**
 * Claim unpublished outbox rows for dispatch, one dispatcher at a time per row.
 *
 * One statement: select candidates `FOR UPDATE SKIP LOCKED`, stamp a lease and
 * count the attempt, return the rows (ADR-0012 §3). A concurrent dispatcher skips
 * rows another transaction is claiming, and the lease keeps them invisible after
 * that transaction commits — until markOutboxPublished, markOutboxFailed
 * (releases the lease, so the next poll retries) or the lease expiring (the
 * claimer crashed).
 *
 * History: the first version gated on `publishedAt: null` alone and both racers
 * claimed every row. The second used `attempts` as an optimistic CAS, which only
 * stopped racers that READ before the winner's write — a dispatcher that read
 * after it saw the incremented value, matched it, and claimed the same row again
 * (the outbox-claim test caught it on PostgreSQL). A lease is a state the second
 * reader can see.
 *
 * markOutboxFailed does NOT increment `attempts`; the claim already counted the try.
 */
export async function claimUnpublishedOutbox(limit = 20): Promise<OutboxRow[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE outbox_event
       SET attempts = attempts + 1,
           locked_until = now() + make_interval(secs => ${OUTBOX_LEASE_SECONDS})
     WHERE id IN (
       SELECT id FROM outbox_event
        WHERE published_at IS NULL
          AND attempts < 10
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY occurred_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  if (rows.length === 0) return [];
  // Re-read through Prisma so callers get the same typed shape (Json payload,
  // camelCase fields) as before; order matches the claim.
  return prisma.outboxEvent.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    orderBy: { occurredAt: 'asc' },
  });
}

/**
 * `updateMany`, not `update`, so a row that is no longer there is a no-op rather
 * than a throw — matching claimUnpublishedOutbox above, which already does its
 * state change as a compare-and-swap.
 *
 * `update` made this the loudest possible failure for the most benign cause. If
 * the row vanished between claim and publish, dispatchOutboxBatch's catch called
 * markOutboxFailed, which threw P2025 for the same reason — so the handler meant
 * to isolate one bad event instead propagated out and abandoned every remaining
 * event in the batch. Returns the number of rows actually changed so a caller can
 * tell "published" from "already gone".
 */
export async function markOutboxPublished(id: string): Promise<number> {
  const { count } = await prisma.outboxEvent.updateMany({
    where: { id },
    data: { publishedAt: new Date(), lastError: null, lockedUntil: null },
  });
  return count;
}

/** Records why a dispatch failed. Deliberately does NOT touch `attempts` —
 * claimUnpublishedOutbox already counted this try when it took the row, and
 * incrementing here too burned the `attempts < 10` retry budget at 2 per cycle,
 * retiring an event after 5 real attempts instead of 10. Mirrors markJobFailed,
 * which leaves the counter to claimPendingJobs for the same reason. */
export async function markOutboxFailed(id: string, error: string): Promise<number> {
  // Same reasoning as markOutboxPublished, and more important here: this IS the
  // error path. A recovery handler that can throw is not a recovery handler.
  const { count } = await prisma.outboxEvent.updateMany({
    where: { id },
    // Releasing the lease is what lets the next poll retry it.
    data: { lastError: error.slice(0, 2000), lockedUntil: null },
  });
  return count;
}
