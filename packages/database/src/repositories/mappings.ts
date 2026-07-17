// EvidenceIndicatorMapping — the governed M:N at the heart of "upload once, reuse
// through governed mappings" (system-context.md core principle). Confirmation is
// a distinct governance act from creation (contract-policy.md), never implicit.
import { prisma } from '../client.js';
import type { MappingStatus, Prisma } from '@prisma/client';

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
}) {
  return prisma.evidenceIndicatorMapping.create({
    data: {
      schoolId,
      evidenceId: input.evidenceId,
      indicatorId: input.indicatorId,
      cycleId: input.cycleId,
      mappingSource: 'human', // ai_suggested reserved for Sprint 2 (x-deferred, OPEN-3)
      status: 'suggested',
      mappedByUserId: input.mappedByUserId,
      rationale: input.rationale,
    },
  });
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
