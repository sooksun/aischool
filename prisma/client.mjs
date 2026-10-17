// PrismaClient factory for code that runs OUTSIDE the built workspace packages:
// prisma/seed.mjs (runs in CI before build:libs), scripts/ops/*, and test files.
// Prisma 7 (ADR-0012 §5) requires a driver adapter — `new PrismaClient()` alone
// throws. Mirrors packages/database/src/client.ts createPrismaClient().
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
