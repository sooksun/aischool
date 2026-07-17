import { loadEnv } from './env.js';
import { createS3Client } from './s3.js';
import { runLoop } from './loop.js';

const env = loadEnv();
const s3 = createS3Client(env);
const ac = new AbortController();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} — shutting down`);
    ac.abort();
  });
}

console.log('[worker] starting', {
  pollMs: env.WORKER_POLL_MS,
  gcAfterDays: env.WORKER_GC_AFTER_DAYS,
  bucket: env.S3_BUCKET,
});

await runLoop(env, s3, ac.signal);
console.log('[worker] stopped');
