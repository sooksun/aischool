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
