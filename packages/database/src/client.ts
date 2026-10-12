// Singleton PrismaClient. Consumes the root prisma/schema.prisma (SEIP-DB-001) —
// the schema stays at repo root (migration history + CI already reference that
// path); this package is the consumption layer module-boundaries.md describes,
// not a relocation of the schema itself.
//
// Prisma 7 (ADR-0012 §5) connects through a driver adapter: node-postgres via
// @prisma/adapter-pg, reading DATABASE_URL (the seip_app role) at construction.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** A new client on its own pool. Tests and scripts that need a client separate
 * from the app's singleton use this rather than `new PrismaClient()`, which
 * Prisma 7 rejects without an adapter. */
export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

declare global {
  // eslint-disable-next-line no-var
  var __seipPrisma: PrismaClient | undefined;
}

// Reuse across hot-reloads in dev so we don't exhaust Postgres connections.
export const prisma: PrismaClient = globalThis.__seipPrisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') {
  globalThis.__seipPrisma = prisma;
}
