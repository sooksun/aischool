// RLS backstop by สพท. (ADR-0019, migration 20261013000200_rls_backstop).
//
// withAreaScope runs `fn` in a transaction that has switched to the read-only
// role seip_scoped and carries the caller's scope. Inside it, PostgreSQL itself
// hides evidence, its files, mappings and upload sessions, and personnel
// profiles outside that scope, whatever the query says — the second wall behind
// the API's authorization. Writes inside it fail with "permission denied".
//
// Use it for every raw-SQL read of tenant data, and for ORM reads where a
// missing filter would leak (listEvidence). Pass `tx` down; the global `prisma`
// client is NOT scoped.
import type { Prisma } from '@prisma/client';
import { prisma } from './client.js';

export interface AreaScope {
  /** Areas (สพท.) of the caller's schools and area memberships. */
  areaIds: readonly string[];
  /** The caller's schools — the fallback for a school that has no area yet. */
  schoolIds: readonly string[];
  /** The caller's person, plus the evaluatees of their committee seats: these
   * portfolios are visible in any area, because they follow their owner. */
  personIds: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidArrayLiteral(ids: readonly string[]): string {
  for (const id of ids) {
    if (!UUID.test(id)) throw new Error(`withAreaScope: not a uuid: ${JSON.stringify(id)}`);
  }
  return `{${[...new Set(ids)].join(',')}}`;
}

export async function withAreaScope<T>(
  scope: AreaScope,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const areaIds = uuidArrayLiteral(scope.areaIds);
  const schoolIds = uuidArrayLiteral(scope.schoolIds);
  const personIds = uuidArrayLiteral(scope.personIds);
  return prisma.$transaction(async (tx) => {
    // Role first: set_config below is transaction-local either way, but the
    // order means nothing in this transaction ever runs unscoped as seip_app.
    await tx.$executeRawUnsafe('SET LOCAL ROLE seip_scoped');
    await tx.$queryRaw`SELECT
      set_config('seip.area_ids', ${areaIds}, true),
      set_config('seip.school_ids', ${schoolIds}, true),
      set_config('seip.person_ids', ${personIds}, true)`;
    return fn(tx);
  });
}

/**
 * The caller's scope from their active memberships: their schools, the areas
 * those schools sit in and their area memberships; their own person, and the
 * evaluatees of every committee seat they hold — the API lets a committee member
 * read those portfolios wherever they were created, so the backstop must too.
 */
export async function resolveAreaScope(input: {
  userId: string;
  personId: string | null;
  schoolIds: readonly string[];
  areaIds: readonly string[];
}): Promise<AreaScope> {
  const [schools, seats] = await Promise.all([
    input.schoolIds.length
      ? prisma.school.findMany({ where: { id: { in: [...input.schoolIds] } }, select: { areaId: true } })
      : Promise.resolve([]),
    prisma.evaluationAssignment.findMany({
      where: { committee: { some: { evaluatorUserId: input.userId } } },
      select: { evaluatee: { select: { personId: true } } },
    }),
  ]);
  const areaIds = new Set(input.areaIds);
  for (const s of schools) if (s.areaId) areaIds.add(s.areaId);
  const personIds = new Set(seats.map((a) => a.evaluatee.personId));
  if (input.personId) personIds.add(input.personId);
  return { areaIds: [...areaIds], schoolIds: [...input.schoolIds], personIds: [...personIds] };
}
