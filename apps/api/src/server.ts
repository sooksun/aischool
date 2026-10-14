import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { loadEnv } from './env.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import { authRoutes } from './routes/auth.js';
import { taxonomyRoutes } from './routes/taxonomy.js';
import { evidenceRoutes } from './routes/evidence.js';
import { mappingRoutes } from './routes/mappings.js';
import { analysisRoutes } from './routes/analysis.js';
import { coverageRoutes } from './routes/coverage.js';
import { committeeRoutes, commentRoutes } from './routes/committee.js';
import { notificationRoutes } from './routes/notifications.js';
import { exportRoutes } from './routes/exports.js';
import { cycleRoutes } from './routes/cycles.js';
import { scoringRoutes } from './routes/scoring.js';
import { reportRoutes } from './routes/reports.js';
import { memberRoutes } from './routes/members.js';
import { areaRoutes } from './routes/areas.js';
import { deviceRoutes } from './routes/devices.js';
import { agreementRoutes } from './routes/agreements.js';
import { phaseGatedRoutes } from './routes/phase-gated.js';
import { webAuthRoutes } from './routes/web-auth.js';
import { createKeycloak } from './lib/keycloak.js';
import { createS3Client, ensureBucket } from './lib/s3.js';
import { configureLoginRateLimiterFromEnv, configureInviteRateLimiterFromEnv } from './lib/login-rate-limit.js';

export async function buildServer() {
  const env = loadEnv();
  // Trust X-Forwarded-For from edge nginx in production (SEIP-OPS-004 rate limit by real client IP).
  const trustProxy = env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true';
  // Process-global singleton (MVP). Edge limit_req remains primary for multi-instance.
  configureLoginRateLimiterFromEnv(process.env);
  // Separate bucket so onboarding a batch of teachers cannot throttle logins for
  // the rest of the school behind the same NAT'd IP (CCR-014).
  configureInviteRateLimiterFromEnv(process.env);

  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
    trustProxy,
    // AuditEvent.requestId is a @db.Uuid column (SEIP-DB-001) — Fastify's default
    // id generator ("req-1", "req-2", ...) isn't a UUID and would 500 on the first
    // audited mutation (found by the smoke test, not by typecheck: this is a
    // runtime/DB-shape mismatch no type system here catches).
    genReqId: () => randomUUID(),
  });

  await app.register(errorHandlerPlugin);
  await app.register(securityHeadersPlugin);
  const keycloak = createKeycloak(env);
  await app.register(authPlugin, { env, keycloak });

  // openapi.yaml: servers[0].url = /api/v1
  await app.register(async (v1) => {
    await v1.register(authRoutes, { env, keycloak });
    await v1.register(webAuthRoutes, { env, keycloak });
    await v1.register(taxonomyRoutes);
    await v1.register(evidenceRoutes, { env });
    await v1.register(mappingRoutes);
    await v1.register(analysisRoutes);
    await v1.register(coverageRoutes);
    await v1.register(committeeRoutes);
    await v1.register(commentRoutes);
    await v1.register(notificationRoutes);
    await v1.register(exportRoutes, { env });
    await v1.register(cycleRoutes);
    // v2 (x-seip-feature: v2, ADR-0017) — frozen, served only behind the flag.
    // listAssignments/createAssignment/getAssignment/listAssignmentEvidence are
    // v1 (committee set-up and view) and register regardless.
    await v1.register(scoringRoutes, { featureScoring: env.FEATURE_SCORING });
    if (env.FEATURE_SCORING) await v1.register(reportRoutes);
    await v1.register(phaseGatedRoutes);
    await v1.register(memberRoutes);
    await v1.register(areaRoutes);
    await v1.register(deviceRoutes, { keycloak });
    await v1.register(agreementRoutes);
  }, { prefix: '/api/v1' });

  if (env.NODE_ENV !== 'test') {
    const s3 = createS3Client(env);
    await ensureBucket(s3, env.S3_BUCKET);
  }

  return { app, env };
}
