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
