import { loadEnv } from './env.js';
import { createS3Client } from './s3.js';
import { pingClamAv } from './clamav.js';
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
  scanProvider: env.SCAN_PROVIDER,
});

// ADR-0009: surface a misconfigured scanner at boot rather than on the first
// upload. Deliberately a loud warning and not a hard exit — a worker that
// refuses to start also stops report generation and storage GC, and the scan
// path already fails closed on its own (files stay `pending`, never `clean`).
// Restarting into a crash loop would turn one broken control into three.
if (env.SCAN_PROVIDER === 'clamav') {
  const reachable = await pingClamAv({
    host: env.CLAMAV_HOST, port: env.CLAMAV_PORT, timeoutMs: 5_000,
  });
  console.log(
    reachable
      ? `[worker] clamd reachable at ${env.CLAMAV_HOST}:${env.CLAMAV_PORT}`
      : `[worker] WARNING: clamd NOT reachable at ${env.CLAMAV_HOST}:${env.CLAMAV_PORT} — `
        + 'uploads will stay `pending` and remain undownloadable until it is back (ADR-0009)',
  );
}

await runLoop(env, s3, ac.signal);
console.log('[worker] stopped');
