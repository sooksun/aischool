// Singleton PrismaClient. Consumes the root prisma/schema.prisma (SEIP-DB-001) —
// the schema stays at repo root (migration history + CI already reference that
// path); this package is the consumption layer module-boundaries.md describes,
// not a relocation of the schema itself.
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __seipPrisma: PrismaClient | undefined;
}

// Reuse across hot-reloads in dev so we don't exhaust Postgres connections.
export const prisma: PrismaClient = globalThis.__seipPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
  globalThis.__seipPrisma = prisma;
}
