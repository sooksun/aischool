// Deletes object storage bytes for soft-deleted evidence (async GC).
import type { S3Client } from '@aws-sdk/client-s3';
import { listFilesForStorageGc, deleteEvidenceFileRow, listExpiredExports, markExportExpired } from '@seip/database';
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
  // P5: exports are short-lived copies of personal data — gone once expired.
  for (const e of await listExpiredExports()) {
    if (e.storageUri) await deleteObject(s3, env.S3_BUCKET, e.storageUri).catch(() => {});
    await markExportExpired(e.id);
    removed += 1;
  }
  return removed;
}
