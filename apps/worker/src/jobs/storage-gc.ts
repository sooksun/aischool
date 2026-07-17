// Deletes object storage bytes for soft-deleted evidence (async GC).
import type { S3Client } from '@aws-sdk/client-s3';
import { listFilesForStorageGc, deleteEvidenceFileRow } from '@seip/database';
import { deleteObject } from '../s3.js';
import type { Env } from '../env.js';

export async function processStorageGc(env: Env, s3: S3Client): Promise<number> {
  const cutoff = new Date(Date.now() - env.WORKER_GC_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const files = await listFilesForStorageGc(cutoff, 50);
  let removed = 0;
  for (const f of files) {
    try {
      await deleteObject(s3, env.S3_BUCKET, f.storageUri);
    } catch {
      // Object may already be gone — still drop metadata row.
    }
    await deleteEvidenceFileRow(f.id);
    removed += 1;
  }
  return removed;
}
