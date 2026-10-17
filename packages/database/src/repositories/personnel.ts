// FR-099a / CCR-023: the person confirms their profile or asks for a correction;
// the school admin edits it. The API decides who may call; this layer writes and
// audits.
import { Prisma, type RoleFamily } from '@prisma/client';
import { prisma } from '../client.js';
import { writeAuditEvent } from '../audit.js';
import { PERSONNEL_SUMMARY_SELECT } from './identity.js';

/** The caller's own active profile at a school, or null. */
async function ownProfile(userId: string, schoolId: string) {
  return prisma.personnelProfile.findFirst({ where: { userId, schoolId, status: 'active' }, select: { id: true } });
}

export async function confirmOwnPersonnel(userId: string, schoolId: string, requestId: string) {
  const own = await ownProfile(userId, schoolId);
  if (!own) return null;
  return prisma.$transaction(async (tx) => {
    const row = await tx.personnelProfile.update({
      where: { id: own.id }, data: { confirmedAt: new Date(), correctionNote: null }, select: PERSONNEL_SUMMARY_SELECT,
    });
    await writeAuditEvent({ schoolId, actorUserId: userId, action: 'confirmed', entityType: 'PersonnelProfile', entityId: own.id, requestId }, tx);
    return row;
  });
}

export async function requestOwnPersonnelCorrection(userId: string, schoolId: string, note: string, requestId: string) {
  const own = await ownProfile(userId, schoolId);
  if (!own) return null;
  return prisma.$transaction(async (tx) => {
    const row = await tx.personnelProfile.update({
      where: { id: own.id }, data: { confirmedAt: null, correctionNote: note }, select: PERSONNEL_SUMMARY_SELECT,
    });
    await writeAuditEvent({ schoolId, actorUserId: userId, action: 'correction_requested', entityType: 'PersonnelProfile', entityId: own.id, requestId }, tx);
    return row;
  });
}

export interface PersonnelPatch {
  fullName?: string;
  employeeCode?: string | null;
  positionRole?: RoleFamily;
  rankLevelCode?: string;
  rankSince?: Date | null;
}

/** Scoped by school: another school's id misses → null. Throws P2002 on a taken employee code. */
export async function updatePersonnelProfile(
  schoolId: string, personnelId: string, patch: PersonnelPatch, actorUserId: string, requestId: string,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.personnelProfile.findFirst({ where: { id: personnelId, schoolId }, select: { ...PERSONNEL_SUMMARY_SELECT, schoolId: true, userId: true } });
    if (!before) return null;
    const reclassified = (patch.positionRole !== undefined && patch.positionRole !== before.positionRole)
      || (patch.rankLevelCode !== undefined && patch.rankLevelCode !== before.rankLevelCode);
    const data: Prisma.PersonnelProfileUpdateInput = {
      ...patch,
      correctionNote: null,
      ...(reclassified ? { confirmedAt: null } : {}),
    };
    const after = await tx.personnelProfile.update({ where: { id: personnelId }, data, select: { ...PERSONNEL_SUMMARY_SELECT, schoolId: true, userId: true } });
    await writeAuditEvent({
      schoolId, actorUserId, action: 'updated', entityType: 'PersonnelProfile', entityId: personnelId, before, after, requestId,
    }, tx);
    return after;
  });
}

export async function getPersonnelInSchool(schoolId: string, personnelId: string) {
  return prisma.personnelProfile.findFirst({ where: { id: personnelId, schoolId }, select: { id: true, positionRole: true, rankLevelCode: true } });
}
