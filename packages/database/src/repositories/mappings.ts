// EvidenceIndicatorMapping — the governed M:N at the heart of "upload once, reuse
// through governed mappings" (system-context.md core principle). Confirmation is
// a distinct governance act from creation (contract-policy.md), never implicit.
import { Prisma, type MappingSource, type MappingStatus } from '@prisma/client';
import { prisma } from '../client.js';
import { enqueueOutboxEvent } from './outbox.js';
import { rankIndicators } from '../lib/local-heuristic-mapping.js';

type Db = Prisma.TransactionClient | typeof prisma;

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export async function listMappingsForEvidence(schoolId: string, evidenceId: string) {
  // schoolId filtered via the evidence relation, not a denormalized column on this
  // query — the mapping row itself DOES carry schoolId (entity-dictionary.md), but
  // going through the evidence relation additionally guarantees the evidence is
  // visible in this school even if a future bug ever let the two disagree.
  return prisma.evidenceIndicatorMapping.findMany({
    where: { evidenceId, schoolId, evidence: { schoolId } },
    orderBy: { mappedAt: 'desc' },
  });
}

/** Throws Prisma P2002 (partial unique index `evidence_indicator_mapping_active_uk`)
 * if an active mapping already exists for this (evidence, indicator, cycle) — the
 * caller maps that to MAP-001. Revoked/rejected rows don't collide (DB-001 design). */
export async function createMapping(schoolId: string, input: {
  evidenceId: string;
  indicatorId: string;
  cycleId: string | null;
  mappedByUserId: string;
  rationale: string | null;
  mappingSource?: MappingSource;
}, db: Db = prisma) {
  return db.evidenceIndicatorMapping.create({
    data: {
      schoolId,
      evidenceId: input.evidenceId,
      indicatorId: input.indicatorId,
      cycleId: input.cycleId,
      mappingSource: input.mappingSource ?? 'human',
      status: 'suggested',
      mappedByUserId: input.mappedByUserId,
      rationale: input.rationale,
    },
  });
}

/** Active (suggested|confirmed) indicator ids already mapped for this evidence+cycle. */
export async function listActiveMappedIndicatorIds(
  schoolId: string,
  evidenceId: string,
  cycleId: string | null,
  db: Db = prisma,
): Promise<string[]> {
  const rows = await db.evidenceIndicatorMapping.findMany({
    where: {
      schoolId,
      evidenceId,
      cycleId,
      status: { in: ['suggested', 'confirmed'] },
    },
    select: { indicatorId: true },
  });
  return rows.map((r) => r.indicatorId);
}

/**
 * ADR-0007 local_heuristic: score evidence text against indicators in a framework,
 * create ai_suggested mappings for top matches that aren't already active.
 *
 * Cleanup H1:
 * - Ranking is read-only and stays outside the write transaction.
 * - All mapping rows + outbox events commit in **one** transaction (no partial
 *   mapping-without-outbox after a mid-loop crash).
 * - PostgreSQL aborts a transaction after P2002, so we do **not** catch-and-continue
 *   inside the tx. Instead: re-read actives under the tx, insert the filtered set,
 *   and on a unique race retry the whole write once. Non-P2002 errors propagate.
 */
export async function suggestMappingsLocalHeuristic(input: {
  schoolId: string;
  evidenceId: string;
  evidenceText: string;
  frameworkVersionId: string;
  cycleId: string | null;
  mappedByUserId: string;
  maxSuggestions: number;
  requestId?: string | null;
}): Promise<{ items: Awaited<ReturnType<typeof createMapping>>[]; skippedActive: number }> {
  // ── read-only ranking (outside tx) ──────────────────────────────────────
  const indicators = await prisma.indicator.findMany({
    where: {
      frameworkVersionId: input.frameworkVersionId,
      indicatorKind: { not: 'workload_gate' },
    },
    select: { id: true, code: true, nameTh: true, indicatorKind: true },
  });

  // Over-fetch so after filtering actives we still have up to maxSuggestions.
  const ranked = rankIndicators(input.evidenceText, indicators, {
    max: Math.max(input.maxSuggestions * 3, input.maxSuggestions + 10),
    minScore: 0.05,
  });

  // ── atomic writes (retry once on concurrent unique race) ────────────────
  const MAX_ATTEMPTS = 2;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const activeIds = new Set(
          await listActiveMappedIndicatorIds(input.schoolId, input.evidenceId, input.cycleId, tx),
        );

        let skippedActive = 0;
        const toCreate = [];
        for (const m of ranked) {
          if (activeIds.has(m.indicatorId)) {
            skippedActive++;
            continue;
          }
          toCreate.push(m);
          if (toCreate.length >= input.maxSuggestions) break;
        }

        const items: Awaited<ReturnType<typeof createMapping>>[] = [];
        for (const m of toCreate) {
          // No try/catch here: a P2002 aborts the PG transaction. Outer loop retries.
          const row = await createMapping(input.schoolId, {
            evidenceId: input.evidenceId,
            indicatorId: m.indicatorId,
            cycleId: input.cycleId,
            mappedByUserId: input.mappedByUserId,
            rationale: m.rationale,
            mappingSource: 'ai_suggested',
          }, tx);
          items.push(row);
          await enqueueOutboxEvent(
            {
              eventType: 'evidence.mapping.suggested',
              schoolId: input.schoolId,
              actorUserId: input.mappedByUserId,
              requestId: input.requestId ?? null,
              payload: {
                mapping_id: row.id,
                evidence_id: input.evidenceId,
                indicator_id: m.indicatorId,
                mapping_source: 'ai_suggested',
              },
            },
            tx,
          );
        }

        if (items.length > 0) {
          await enqueueOutboxEvent(
            {
              eventType: 'ai.suggestion.created',
              schoolId: input.schoolId,
              actorUserId: input.mappedByUserId,
              requestId: input.requestId ?? null,
              payload: {
                evidence_id: input.evidenceId,
                mapping_ids: items.map((i) => i.id),
                provider: 'local_heuristic',
                suggestion_count: items.length,
              },
            },
            tx,
          );
        }

        return { items, skippedActive };
      });
    } catch (e) {
      lastError = e;
      if (isUniqueViolation(e) && attempt + 1 < MAX_ATTEMPTS) {
        // Concurrent suggest on same (evidence, indicator, cycle) — retry with fresh actives.
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

export interface ListMappingsFilter {
  indicatorId?: string;
  cycleId?: string;
  status?: MappingStatus;
  /** 'committee' grant: mappings whose evidence belongs to an evaluatee the caller
   * currently sits on a committee for (permissions.yaml note). */
  ownerPersonnelIdIn?: string[];
  page: number;
  pageSize: number;
}

/** School-wide queue (director/school_admin grant), or narrowed to the caller's
 * current evaluatees for the evaluator:committee grant. */
export async function listMappings(schoolId: string, f: ListMappingsFilter) {
  const where: Prisma.EvidenceIndicatorMappingWhereInput = {
    schoolId,
    indicatorId: f.indicatorId,
    cycleId: f.cycleId,
    status: f.status,
    ...(f.ownerPersonnelIdIn ? { evidence: { ownerPersonnelId: { in: f.ownerPersonnelIdIn } } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.evidenceIndicatorMapping.findMany({
      where,
      orderBy: { mappedAt: 'desc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.evidenceIndicatorMapping.count({ where }),
  ]);
  return { items, total };
}

/** Tenancy + ownership lookup for actOnMapping — the contract's mappingId path has
 * no schoolId, so the API layer needs this to verify tenancy/role/ownership before
 * acting (mirrors how getEvidenceDetail folds schoolId into its own query instead). */
export async function getMappingForAction(mappingId: string) {
  return prisma.evidenceIndicatorMapping.findUnique({
    where: { id: mappingId },
    select: {
      id: true,
      schoolId: true,
      status: true,
      mappedByUserId: true,
      evidence: { select: { ownerPersonnelId: true } },
    },
  });
}

/** Full row for serialization after an action — deliberately separate from
 * getMappingForAction's narrow select (that one exists for the tenancy/ownership
 * check; this one is "give me everything the API response needs"). */
export async function getMappingById(mappingId: string) {
  return prisma.evidenceIndicatorMapping.findUnique({ where: { id: mappingId } });
}

export async function confirmMapping(mappingId: string, confirmedByUserId: string) {
  const result = await prisma.evidenceIndicatorMapping.updateMany({
    where: { id: mappingId, status: 'suggested' }, // MAP-002 if not currently suggested
    data: { status: 'confirmed', confirmedByUserId, confirmedAt: new Date() },
  });
  return result.count > 0;
}

export async function rejectMapping(mappingId: string, rationale: string | null) {
  const result = await prisma.evidenceIndicatorMapping.updateMany({
    where: { id: mappingId, status: 'suggested' },
    data: { status: 'rejected', rationale },
  });
  return result.count > 0;
}

/** Revoke is allowed from suggested OR confirmed (permissions.yaml: owner may
 * revoke their own 'suggested' mapping; school-level roles may revoke any active one). */
export async function revokeMapping(mappingId: string) {
  const result = await prisma.evidenceIndicatorMapping.updateMany({
    where: { id: mappingId, status: { in: ['suggested', 'confirmed'] } },
    data: { status: 'revoked' },
  });
  return result.count > 0;
}
