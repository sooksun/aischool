// Worker job queue — single process claims pending rows (SEIP-WORKER-001).
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export type WorkerJobType = 'file.process' | 'storage.gc' | 'report.generate';

export interface EnqueueJobInput {
  jobType: WorkerJobType | string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
  id?: string;
}

export async function enqueueWorkerJob(
  input: EnqueueJobInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return tx.workerJob.create({
    data: {
      id: input.id ?? randomUUID(),
      jobType: input.jobType,
      payload: input.payload,
      status: 'pending',
      availableAt: input.availableAt ?? new Date(),
    },
  });
}

export async function claimPendingJobs(limit = 10) {
  const now = new Date();
  const candidates = await prisma.workerJob.findMany({
    where: {
      status: 'pending',
      availableAt: { lte: now },
      attempts: { lt: 8 },
    },
    orderBy: { availableAt: 'asc' },
    take: limit,
  });

  const claimed = [];
  for (const job of candidates) {
    const result = await prisma.workerJob.updateMany({
      where: { id: job.id, status: 'pending' },
      data: {
        status: 'running',
        lockedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (result.count === 1) {
      const fresh = await prisma.workerJob.findUniqueOrThrow({ where: { id: job.id } });
      claimed.push(fresh);
    }
  }
  return claimed;
}

/**
 * file_ids that already have a `file.process` job waiting or in flight.
 *
 * The re-scan sweep is expected to be run more than once — an operator batches it
 * with `--limit`, or re-runs it after fixing whatever made clamd unreachable.
 * Without this, each run would pile a second job onto files the first run already
 * queued, multiplying clamd's work and emitting a duplicate `scan_completed`
 * event per copy.
 *
 * Read into a Set rather than filtered per file in SQL: the pending queue is
 * small by design (the worker drains 10 per poll), and Prisma's MySQL JSON
 * filters take a single `'$.file_id'` path equality (ADR-0008), so a batch
 * membership test would mean one query per candidate.
 */
export async function listQueuedFileProcessTargets(): Promise<Set<string>> {
  const rows = await prisma.workerJob.findMany({
    where: { jobType: 'file.process', status: { in: ['pending', 'running'] } },
    select: { payload: true },
  });
  const ids = new Set<string>();
  for (const row of rows) {
    const fileId = (row.payload as { file_id?: unknown } | null)?.file_id;
    if (typeof fileId === 'string') ids.add(fileId);
  }
  return ids;
}

/**
 * Progress and, more importantly, stalls for the re-scan sweep.
 *
 * Groups terminal failures by message because the interesting case is a repeated
 * one — "object missing from storage" ×46 is a story about the store, where 46
 * separate lines are noise.
 *
 * That grouping has to erase the identifiers, which the first version did not:
 * splitting on `(` left the file id in the key, so the first real full-store
 * sweep printed 46 lines each reading `1× object missing from storage for file
 * <uuid>` — precisely the noise this function exists to prevent. Ids are what
 * make otherwise-identical failures look distinct.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export async function summariseRescanJobs(): Promise<{
  queued: number;
  failed: number;
  errors: [string, number][];
}> {
  const [queued, failedRows] = await Promise.all([
    prisma.workerJob.count({
      where: { jobType: 'file.process', status: { in: ['pending', 'running'] } },
    }),
    prisma.workerJob.findMany({
      where: { jobType: 'file.process', status: 'failed' },
      select: { lastError: true },
      take: 1000,
    }),
  ]);
  const counts = new Map<string, number>();
  for (const row of failedRows) {
    const key = (row.lastError ?? 'unknown error')
      .split('(')[0]
      .replace(UUID_RE, '<id>')
      .trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    queued,
    failed: failedRows.length,
    errors: [...counts].sort((a, b) => b[1] - a[1]),
  };
}

export async function markJobDone(id: string) {
  return prisma.workerJob.update({
    where: { id },
    data: {
      status: 'done',
      completedAt: new Date(),
      lastError: null,
    },
  });
}

export async function markJobFailed(id: string, error: string, retryDelayMs = 30_000) {
  return prisma.workerJob.update({
    where: { id },
    data: {
      status: 'pending',
      lockedAt: null,
      availableAt: new Date(Date.now() + retryDelayMs),
      lastError: error.slice(0, 2000),
    },
  });
}

export async function markJobTerminalFailed(id: string, error: string) {
  return prisma.workerJob.update({
    where: { id },
    data: {
      status: 'failed',
      completedAt: new Date(),
      lastError: error.slice(0, 2000),
    },
  });
}
