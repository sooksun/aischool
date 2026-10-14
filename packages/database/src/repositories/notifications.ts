// P4 notifications (FR-100/102). The outbox dispatcher turns domain events into
// inbox rows for the people they concern: idempotent on (event, recipient), so a
// re-dispatched event never notifies twice. Texts are Thai, carry no file names
// or evidence titles, and point at an in-app route.
import type { NotificationKind, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export interface OutboxLike { id: string; eventType: string; payload: unknown }

interface Draft { kind: NotificationKind; titleTh: string; bodyTh: string | null; entityType: string; entityId: string; route: string }

/** Every account of the evidence owner (ADR-0015: evidence belongs to a person). */
async function ownerUserIds(evidenceId: string): Promise<string[]> {
  const ev = await prisma.evidence.findUnique({ where: { id: evidenceId }, select: { ownerPersonId: true } });
  if (!ev) return [];
  const users = await prisma.userAccount.findMany({ where: { personId: ev.ownerPersonId, status: 'active' }, select: { id: true } });
  return users.map((u) => u.id);
}

function draftFor(eventType: string, p: Record<string, unknown>): Draft | null {
  const evidenceId = typeof p.evidence_id === 'string' ? p.evidence_id : null;
  if (!evidenceId) return null;
  const at = (kind: NotificationKind, titleTh: string, bodyTh: string | null) =>
    ({ kind, titleTh, bodyTh, entityType: 'Evidence', entityId: evidenceId, route: `/evidence/${evidenceId}` });
  switch (eventType) {
    case 'analysis.completed': {
      const n = Number(p.suggestion_count ?? 0);
      return n > 0 ? at('suggestions_ready', 'มีตัวชี้วัดที่ระบบแนะนำสำหรับหลักฐานของคุณ', `${n} รายการรอคุณตรวจ — ระบบไม่ผูกให้จนกว่าคุณจะยืนยัน`) : null;
    }
    case 'evidence.file.scan_completed':
      return p.scan_status === 'blocked'
        ? at('processing_failed', 'ไฟล์หลักฐานถูกกักไว้', 'ระบบรับไฟล์นี้ไม่ได้ (ไฟล์ไม่ตรงกับที่ส่ง หรือไม่ผ่านการตรวจ) — เปิดดูรายละเอียดได้')
        : null;
    case 'mapping.validated':
      return at('mapping_validated', 'การผูกตัวชี้วัดได้รับการรับรองแล้ว', null);
    case 'mapping.returned':
      return at('mapping_returned', 'การผูกตัวชี้วัดถูกส่งกลับ', 'เปิดดูเหตุผลจากผู้ตรวจและแก้ไขได้');
    default:
      return null;
  }
}

/** Consumer side of the outbox (events.yaml `consumers: [notification]`). Returns rows created. */
export async function notifyFromEvent(ev: OutboxLike): Promise<number> {
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  const draft = draftFor(ev.eventType, p);
  if (!draft) return 0;
  const userIds = await ownerUserIds(draft.entityId);
  if (userIds.length === 0) return 0;
  const r = await prisma.notification.createMany({
    data: userIds.map((userId) => ({ ...draft, userId, sourceEventId: ev.id })),
    skipDuplicates: true,
  });
  return r.count;
}

export async function listNotifications(userId: string, f: { unread?: boolean; offset: number; limit: number }) {
  const where: Prisma.NotificationWhereInput = { userId, ...(f.unread ? { readAt: null } : {}) };
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: f.offset, take: f.limit + 1 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: rows.slice(0, f.limit), more: rows.length > f.limit, unread };
}

/** Marks the caller's own notifications only — someone else's ids are ignored. */
export async function markNotificationsRead(userId: string, ids: string[] | 'all') {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}

export async function getNotificationPreference(userId: string) {
  return (await prisma.notificationPreference.findUnique({ where: { userId } }))
    ?? { userId, push: true, email: false, quietStart: null, quietEnd: null };
}

export async function putNotificationPreference(userId: string, v: { push: boolean; email: boolean; quietStart: string | null; quietEnd: string | null }) {
  return prisma.notificationPreference.upsert({ where: { userId }, create: { userId, ...v }, update: v });
}
