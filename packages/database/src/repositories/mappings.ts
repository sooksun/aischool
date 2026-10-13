// EvidenceIndicatorMapping — the governed M:N at the heart of "upload once, reuse
// through governed mappings". Two tiers (ADR-0015, CCR-017):
//   1. the OWNER confirms (manual add, or accepting an AI suggestion) → owner_confirmed
//   2. the director or an assigned committee member validates or returns it
// A mapping is keyed on the framework VERSION, not a cycle: a portfolio item
// outlives any one evaluation cycle. Every state change bumps `version` (the
// If-Match ETag) and emits its event in the same transaction (outbox rule).
import { Prisma, type MappingSource, type MappingStatus, type ValidatorRole } from '@prisma/client';
import { prisma } from '../client.js';
import { enqueueOutboxEvent } from './outbox.js';

type Db = Prisma.TransactionClient | typeof prisma;

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** Mappings of one evidence item. The caller has already authorized the evidence. */
export async function listMappingsForEvidence(evidenceId: string) {
  return prisma.evidenceIndicatorMapping.findMany({
    where: { evidenceId },
    orderBy: { ownerConfirmedAt: 'desc' },
  });
}

/**
 * Owner confirmation — the only way a mapping comes into existence. Throws Prisma
 * P2002 (partial unique `evidence_indicator_mapping_active_uk`) when a live mapping
 * already exists for (evidence, indicator, framework version); the API maps it to
 * MAP-001. The framework version comes from the indicator, never from the client.
 */
export async function createOwnerMapping(input: {
  evidenceId: string;
  /** The owner's current school (FR-051): its director validates this mapping.
   * After a transfer that is the new school, not the evidence's origin. */
  schoolId: string;
  indicatorId: string;
  frameworkVersionId: string;
  ownerUserId: string;
  source: MappingSource;
  note?: string | null;
  aiSuggestionId?: string | null;
  locatorSnapshot?: Prisma.InputJsonValue | null;
  requestId?: string | null;
}, db?: Prisma.TransactionClient) {
  const run = async (tx: Prisma.TransactionClient) => {
    const row = await tx.evidenceIndicatorMapping.create({
      data: {
        schoolId: input.schoolId,
        evidenceId: input.evidenceId,
        indicatorId: input.indicatorId,
        frameworkVersionId: input.frameworkVersionId,
        mappingSource: input.source,
        status: 'owner_confirmed',
        note: input.note ?? null,
        aiSuggestionId: input.aiSuggestionId ?? null,
        locatorSnapshot: input.locatorSnapshot ?? Prisma.JsonNull,
        ownerConfirmedByUserId: input.ownerUserId,
      },
    });
    await enqueueOutboxEvent({
      eventType: 'mapping.owner_confirmed',
      schoolId: input.schoolId,
      actorUserId: input.ownerUserId,
      requestId: input.requestId ?? null,
      payload: { mapping_id: row.id, evidence_id: input.evidenceId, indicator_id: input.indicatorId, mapping_source: input.source },
    }, tx);
    return row;
  };
  return db ? run(db) : prisma.$transaction(run);
}

export interface ListMappingsFilter {
  indicatorId?: string;
  frameworkVersionId?: string;
  status?: MappingStatus;
  /** 'committee' grant: mappings whose evidence belongs to a person the caller
   * currently sits on a committee for. */
  ownerPersonIdIn?: string[];
  page: number;
  pageSize: number;
}

/** Validator queue: school-wide (director / school_admin / area-r), or narrowed
 * to the caller's evaluatees for the committee grant. */
export async function listMappings(schoolId: string, f: ListMappingsFilter) {
  const where: Prisma.EvidenceIndicatorMappingWhereInput = {
    schoolId,
    indicatorId: f.indicatorId,
    frameworkVersionId: f.frameworkVersionId,
    status: f.status,
    evidence: { deletedAt: null, ...(f.ownerPersonIdIn ? { ownerPersonId: { in: f.ownerPersonIdIn } } : {}) },
  };
  const [items, total] = await Promise.all([
    prisma.evidenceIndicatorMapping.findMany({
      where,
      orderBy: { ownerConfirmedAt: 'desc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.evidenceIndicatorMapping.count({ where }),
  ]);
  return { items, total };
}

/** What actOnMapping needs to authorize before acting: the mapping path carries no
 * school id, so tenancy, ownership and committee checks all start here. */
export async function getMappingForAction(mappingId: string) {
  return prisma.evidenceIndicatorMapping.findUnique({
    where: { id: mappingId },
    select: {
      id: true, schoolId: true, status: true, version: true, evidenceId: true, indicatorId: true,
      evidence: { select: { ownerPersonId: true, deletedAt: true } },
    },
  });
}

export async function getMappingById(mappingId: string) {
  return prisma.evidenceIndicatorMapping.findUnique({ where: { id: mappingId } });
}

export type MappingActionResult =
  | { ok: true; row: NonNullable<Awaited<ReturnType<typeof getMappingById>>> }
  | { ok: false; reason: 'missing' | 'stale' | 'state' };

/**
 * Compare-and-swap on (id, version, allowed from-states). A zero-row update is
 * then classified: gone (RES-001), stale version (RES-004 / 412), or a state the
 * action is not allowed from (MAP-002). The event is written in the same
 * transaction as the transition.
 */
async function transition(
  mappingId: string,
  expectedVersion: number,
  from: MappingStatus[],
  data: Prisma.EvidenceIndicatorMappingUncheckedUpdateManyInput,
  event: (row: NonNullable<Awaited<ReturnType<typeof getMappingById>>>) => Parameters<typeof enqueueOutboxEvent>[0],
): Promise<MappingActionResult> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.evidenceIndicatorMapping.updateMany({
      where: { id: mappingId, version: expectedVersion, status: { in: from } },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) {
      const now = await tx.evidenceIndicatorMapping.findUnique({ where: { id: mappingId }, select: { version: true } });
      if (!now) return { ok: false, reason: 'missing' } as const;
      return { ok: false, reason: now.version !== expectedVersion ? 'stale' : 'state' } as const;
    }
    const row = (await tx.evidenceIndicatorMapping.findUnique({ where: { id: mappingId } }))!;
    await enqueueOutboxEvent(event(row), tx);
    return { ok: true, row } as const;
  });
}

export function validateMapping(mappingId: string, expectedVersion: number, actor: { userId: string; role: ValidatorRole }, requestId?: string | null) {
  return transition(mappingId, expectedVersion, ['owner_confirmed'],
    { status: 'validated', validatedByUserId: actor.userId, validatedAt: new Date(), validatorRole: actor.role, returnNote: null },
    (row) => ({
      eventType: 'mapping.validated', schoolId: row.schoolId, actorUserId: actor.userId, requestId: requestId ?? null,
      payload: { mapping_id: row.id, evidence_id: row.evidenceId, indicator_id: row.indicatorId, validated_by_user_id: actor.userId, validator_role: actor.role },
    }));
}

export function returnMapping(mappingId: string, expectedVersion: number, actor: { userId: string; role: ValidatorRole }, note: string, requestId?: string | null) {
  return transition(mappingId, expectedVersion, ['owner_confirmed'],
    { status: 'returned', validatedByUserId: actor.userId, validatedAt: new Date(), validatorRole: actor.role, returnNote: note },
    (row) => ({
      eventType: 'mapping.returned', schoolId: row.schoolId, actorUserId: actor.userId, requestId: requestId ?? null,
      payload: { mapping_id: row.id, evidence_id: row.evidenceId, indicator_id: row.indicatorId, validated_by_user_id: actor.userId },
    }));
}

/** Owner revoke — from any live state. Frees the (evidence, indicator, version) slot. */
export function revokeMapping(mappingId: string, expectedVersion: number, actorUserId: string, requestId?: string | null) {
  return transition(mappingId, expectedVersion, ['owner_confirmed', 'validated', 'returned'],
    { status: 'revoked' },
    (row) => ({
      eventType: 'mapping.revoked', schoolId: row.schoolId, actorUserId, requestId: requestId ?? null,
      payload: { mapping_id: row.id, evidence_id: row.evidenceId, indicator_id: row.indicatorId },
    }));
}

/** Schools of the live (not revoked) mappings on an evidence item. A school whose
 * director must validate a mapping may read the evidence behind it (FR-051). */
export async function listLiveMappingSchoolIds(evidenceId: string): Promise<string[]> {
  const rows = await prisma.evidenceIndicatorMapping.findMany({
    where: { evidenceId, status: { not: 'revoked' } }, select: { schoolId: true }, distinct: ['schoolId'],
  });
  return rows.map((r) => r.schoolId);
}
