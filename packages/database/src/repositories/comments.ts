// CCR-028 (FR-064): comments and requests for more information per indicator of
// one assignment, and the evaluatee's replies. Plain text — no score, no status.
import type { AssignmentCommentAuthorRole, AssignmentCommentKind } from '@prisma/client';
import { prisma } from '../client.js';
import { enqueueOutboxEvent } from './outbox.js';

export async function listAssignmentComments(assignmentId: string, indicatorId?: string) {
  return prisma.assignmentComment.findMany({
    where: { assignmentId, ...(indicatorId ? { indicatorId } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function getAssignmentComment(id: string) {
  return prisma.assignmentComment.findUnique({ where: { id } });
}

export async function getPersonnelUserId(personnelId: string): Promise<string | null> {
  return (await prisma.personnelProfile.findUnique({ where: { id: personnelId }, select: { userId: true } }))?.userId ?? null;
}

export async function indicatorInFramework(indicatorId: string, frameworkVersionId: string): Promise<boolean> {
  return (await prisma.indicator.count({ where: { id: indicatorId, frameworkVersionId } })) > 0;
}

export async function createAssignmentComment(input: {
  assignmentId: string; schoolId: string; indicatorId: string; kind: AssignmentCommentKind; body: string;
  parentId: string | null; authorUserId: string; authorRole: AssignmentCommentAuthorRole; requestId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.assignmentComment.create({
      data: {
        assignmentId: input.assignmentId, schoolId: input.schoolId, indicatorId: input.indicatorId, kind: input.kind,
        body: input.body, parentId: input.parentId, authorUserId: input.authorUserId, authorRole: input.authorRole,
      },
    });
    await enqueueOutboxEvent({
      eventType: 'assignment.comment.created', schoolId: input.schoolId, actorUserId: input.authorUserId, requestId: input.requestId ?? null,
      // The body never goes into the event (events.yaml).
      payload: { assignment_id: input.assignmentId, comment_id: row.id, indicator_id: input.indicatorId, kind: input.kind },
    }, tx);
    return row;
  });
}
