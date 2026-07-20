import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Poll interval for the worker loop (ms). */
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
  /** Soft-deleted evidence older than this many days is GC'd from object storage. */
  WORKER_GC_AFTER_DAYS: z.coerce.number().int().nonnegative().default(7),

  // ── malware scanning (ADR-0009) ──
  //
  // Defaults to `none` so local development needs no extra service, and `none`
  // keeps today's honest `unscanned` status rather than pretending. There is
  // deliberately no automatic fallback from `clamav` to `none`: a deployment
  // that meant to scan and quietly stopped is the exact failure ADR-0009 exists
  // to prevent, so switching it off has to be something someone wrote down.
  SCAN_PROVIDER: z.enum(['none', 'clamav']).default('none'),
  CLAMAV_HOST: z.string().default('127.0.0.1'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** clamd's own StreamMaxLength is 25 MB by default. Anything above this is
   * quarantined rather than waved through — "too big to check" is not "safe"
   * (ADR-0009 §4). Raise clamd's limit AND this together if you would rather
   * scan large video than block it. */
  CLAMAV_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid worker environment:\n${issues}`);
  }
  return parsed.data;
}
