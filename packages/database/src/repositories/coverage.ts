// FR-052/053/056/057 coverage: per indicator of one framework version, how many
// live mappings sit in each state and how many AI suggestions are still open.
// A person's own portfolio is counted by owner; a school or area by the school
// each mapping belongs to (the owner's school when confirmed, FR-051). Only
// counts leave here — never titles or names at school or area scope.
import { prisma } from '../client.js';

export interface IndicatorCount {
  indicatorId: string; indicatorCode: string;
  ownerConfirmed: number; validated: number; returned: number; openSuggestions: number;
}

export async function getFrameworkIndicators(frameworkVersionId: string) {
  return prisma.indicator.findMany({
    where: { frameworkVersionId, indicatorKind: { not: 'workload_gate' } },
    orderBy: [{ domain: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    select: { id: true, code: true },
  });
}

type Scope = { personId: string } | { schoolIds: string[] };

export async function coverageCounts(frameworkVersionId: string, scope: Scope): Promise<IndicatorCount[]> {
  const indicators = await getFrameworkIndicators(frameworkVersionId);
  const evidenceLive = { deletedAt: null, ownerAcceptedAt: { not: null } };
  const mappingWhere = 'personId' in scope
    ? { evidence: { ...evidenceLive, ownerPersonId: scope.personId } }
    : { schoolId: { in: scope.schoolIds }, evidence: evidenceLive };
  const [mappings, suggestions] = await Promise.all([
    prisma.evidenceIndicatorMapping.groupBy({
      by: ['indicatorId', 'status'],
      where: { frameworkVersionId, status: { not: 'revoked' }, ...mappingWhere },
      _count: { _all: true },
    }),
    'personId' in scope
      ? prisma.aiSuggestion.groupBy({
        by: ['indicatorId'],
        where: { frameworkVersionId, status: 'open', evidence: { ...evidenceLive, ownerPersonId: scope.personId } },
        _count: { _all: true },
      })
      : prisma.aiSuggestion.groupBy({
        by: ['indicatorId'],
        where: {
          frameworkVersionId, status: 'open',
          evidence: { ...evidenceLive, originSchoolId: { in: scope.schoolIds } },
        },
        _count: { _all: true },
      }),
  ]);
  const count = (id: string, status: string) => mappings.find((m) => m.indicatorId === id && m.status === status)?._count._all ?? 0;
  return indicators.map((i) => ({
    indicatorId: i.id,
    indicatorCode: i.code,
    ownerConfirmed: count(i.id, 'owner_confirmed'),
    validated: count(i.id, 'validated'),
    returned: count(i.id, 'returned'),
    openSuggestions: suggestions.find((s) => s.indicatorId === i.id)?._count._all ?? 0,
  }));
}

/** Active staff (distinct people) at these schools — the denominator of a readiness view. */
export async function countPeopleAtSchools(schoolIds: string[]): Promise<number> {
  const rows = await prisma.personnelProfile.findMany({
    where: { schoolId: { in: schoolIds }, status: 'active' },
    select: { personId: true },
    distinct: ['personId'],
  });
  return rows.length;
}

/** Schools where this person is active staff — where a director or school admin may see their coverage. */
export async function listActiveSchoolIdsOfPerson(personId: string): Promise<string[]> {
  const rows = await prisma.personnelProfile.findMany({ where: { personId, status: 'active' }, select: { schoolId: true } });
  return [...new Set(rows.map((r) => r.schoolId))];
}

export async function listSchoolIdsInArea(areaId: string): Promise<string[]> {
  return (await prisma.school.findMany({ where: { areaId }, select: { id: true } })).map((s) => s.id);
}

/**
 * FR-060 committee view: an evaluatee's confirmed evidence per indicator for one
 * framework version — owner_confirmed or validated mappings on accepted,
 * undeleted items, ordered by indicator. Offset-paged (the cursor is the offset).
 */
export async function listCommitteeEvidence(input: {
  personId: string; frameworkVersionId: string; indicatorId?: string; offset: number; limit: number;
}) {
  const rows = await prisma.evidenceIndicatorMapping.findMany({
    where: {
      frameworkVersionId: input.frameworkVersionId,
      status: { in: ['owner_confirmed', 'validated'] },
      ...(input.indicatorId ? { indicatorId: input.indicatorId } : {}),
      evidence: { ownerPersonId: input.personId, deletedAt: null, ownerAcceptedAt: { not: null } },
    },
    include: {
      indicator: { select: { code: true, sortOrder: true, domain: { select: { sortOrder: true } } } },
      evidence: { include: { files: { where: { scanStatus: { in: ['clean', 'unscanned', 'sanitised'] } }, include: { duplicateOf: { select: { evidenceId: true } } } } } },
    },
    orderBy: [{ indicator: { domain: { sortOrder: 'asc' } } }, { indicator: { sortOrder: 'asc' } }, { ownerConfirmedAt: 'asc' }],
    skip: input.offset,
    take: input.limit + 1,
  });
  return { items: rows.slice(0, input.limit), more: rows.length > input.limit };
}

export async function getPersonIdOfPersonnel(personnelId: string): Promise<string | null> {
  return (await prisma.personnelProfile.findUnique({ where: { id: personnelId }, select: { personId: true } }))?.personId ?? null;
}
