// CCR-021 (FR-090): the school records an area admin manages. The API decides
// who may call these (the caller's own area only); this layer just reads and writes.
import { Prisma } from '@prisma/client';
import { prisma } from '../client.js';
import { writeAuditEvent } from '../audit.js';

const SELECT = { id: true, code: true, name: true, areaId: true, status: true } as const;

export async function getAreaById(areaId: string) {
  return prisma.area.findUnique({ where: { id: areaId }, select: { id: true } });
}

export async function getSchoolRecord(schoolId: string) {
  return prisma.school.findUnique({ where: { id: schoolId }, select: SELECT });
}

export async function listSchoolsInArea(areaId: string) {
  return prisma.school.findMany({ where: { areaId }, select: SELECT, orderBy: { name: 'asc' } });
}

/** null when the code is taken (system-wide unique). */
export async function createSchoolInArea(
  input: { areaId: string; code: string; name: string }, actorUserId: string, requestId: string,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({ data: input, select: SELECT });
      await writeAuditEvent({
        schoolId: school.id, actorUserId, action: 'created', entityType: 'School', entityId: school.id,
        after: school, requestId,
      }, tx);
      return school;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
    throw e;
  }
}

export async function updateSchoolRecord(
  schoolId: string, patch: { name?: string; status?: 'active' | 'inactive' }, actorUserId: string, requestId: string,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.school.findUnique({ where: { id: schoolId }, select: SELECT });
    const after = await tx.school.update({ where: { id: schoolId }, data: patch, select: SELECT });
    await writeAuditEvent({
      schoolId, actorUserId, action: patch.status && patch.status !== before?.status ? (patch.status === 'inactive' ? 'closed' : 'reopened') : 'updated',
      entityType: 'School', entityId: schoolId, before: before ?? undefined, after, requestId,
    }, tx);
    return after;
  });
}
