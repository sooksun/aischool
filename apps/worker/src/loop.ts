import type { S3Client } from '@aws-sdk/client-s3';
import {
  claimPendingJobs,
  markJobDone,
  markJobFailed,
  markJobTerminalFailed,
  enqueueWorkerJob,
} from '@seip/database';
import type { Env } from './env.js';
import { processFileJob, type FileProcessPayload } from './jobs/file-process.js';
import { processStorageGc } from './jobs/storage-gc.js';
import { processReportGenerate, type ReportGeneratePayload } from './jobs/report-generate.js';
import { dispatchOutboxBatch } from './jobs/outbox-dispatch.js';

let gcScheduled = false;

export interface RunOnceOptions {
  /** When true (default), ensure a storage.gc job is queued once per process. */
  scheduleGc?: boolean;
}

/** One poll cycle — exported for integration tests. */
export async function runOnce(
  env: Env,
  s3: S3Client,
  opts: RunOnceOptions = {},
): Promise<{
  jobs: number;
  outbox: number;
  gcRemoved: number;
}> {
  const scheduleGc = opts.scheduleGc !== false;
  // Ensure a GC job exists periodically (single-worker MVP: re-enqueue if idle)
  if (scheduleGc && !gcScheduled) {
    await enqueueWorkerJob({
      jobType: 'storage.gc',
      payload: {},
      availableAt: new Date(),
    });
    gcScheduled = true;
  }

  const jobs = await claimPendingJobs(10);
  let gcRemoved = 0;
  for (const job of jobs) {
    try {
      if (job.jobType === 'file.process') {
        const payload = job.payload as unknown as FileProcessPayload;
        await processFileJob(env, s3, payload);
      } else if (job.jobType === 'storage.gc') {
        gcRemoved += await processStorageGc(env, s3);
        // Re-schedule next GC window
        await enqueueWorkerJob({
          jobType: 'storage.gc',
          payload: {},
          availableAt: new Date(Date.now() + 60 * 60 * 1000),
        });
      } else if (job.jobType === 'report.generate') {
        const payload = job.payload as unknown as ReportGeneratePayload;
        await processReportGenerate(payload);
      } else {
        throw new Error(`unknown job type ${job.jobType}`);
      }
      await markJobDone(job.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (job.attempts >= 8) {
        await markJobTerminalFailed(job.id, msg);
      } else {
        await markJobFailed(job.id, msg);
      }
    }
  }

  const outbox = await dispatchOutboxBatch(50);
  return { jobs: jobs.length, outbox, gcRemoved };
}

export async function runLoop(env: Env, s3: S3Client, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const r = await runOnce(env, s3);
      if (r.jobs > 0 || r.outbox > 0 || r.gcRemoved > 0) {
        console.log('[worker]', new Date().toISOString(), r);
      }
    } catch (e) {
      console.error('[worker] loop error', e);
    }
    await new Promise((resolve) => {
      const t = setTimeout(resolve, env.WORKER_POLL_MS);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        resolve(undefined);
      }, { once: true });
    });
  }
}
