// Typed, validated environment — fails fast at boot rather than at the first
// request that happens to touch a missing var.
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  S3_ENDPOINT: z.string().url(),
  /** The origin browsers reach the store at, used ONLY to sign presigned URLs.
   * Unset = S3_ENDPOINT (dev, where both are localhost). In a container stack
   * S3_ENDPOINT is an internal name (http://seaweedfs:8333) no browser can
   * resolve; point this at the public origin whose /<bucket>/ path the web
   * gateway forwards to the store with Host preserved (the signature covers it). */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  PORT: z.coerce.number().int().positive().default(3001),
  /** Listen address (index.ts). 0.0.0.0 inside a container. */
  HOST: z.string().min(1).default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** ADR-0017: committee scoring and report approval are v2. Their routes are
   * registered only when this is true; the code stays compiled and tested. */
  FEATURE_SCORING: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** ADR-0014: when set, access tokens signed by this Keycloak realm are accepted
   * alongside the API's own (e.g. http://localhost:8180/realms/seip). */
  KEYCLOAK_ISSUER: z.string().url().optional(),
  KEYCLOAK_AUDIENCE: z.string().min(1).default('seip-api'),
  /** CCR-018 web BFF: the confidential client, and the origin the browser sees
   * (the callback URL is built from it, never from the Host header). Web sign-in
   * is served only when all three Keycloak settings are present. */
  KEYCLOAK_WEB_CLIENT_ID: z.string().min(1).default('seip-web'),
  KEYCLOAK_WEB_CLIENT_SECRET: z.string().min(1).optional(),
  WEB_PUBLIC_ORIGIN: z.string().url().optional(),
  /** ADR-0014 provisioning: the service-account client that creates the
   * Keycloak user for a SEIP account at accept-invite / password login. */
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).default('seip-provisioner'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1).optional(),
  /** permissions.yaml `min_acr` → 403 AUTH-006 below the level. Off until the
   * clients can step up through Keycloak; the API's own tokens are acr 1, so
   * turning this on without Keycloak locks out every step-up operation. */
  ENFORCE_MIN_ACR: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
