// P4 notifications (FR-100/102). Self-scoped (permissions.yaml
// any_authenticated): the caller's own inbox and preferences, never anyone
// else's — no user id parameter exists.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listNotifications, markNotificationsRead, getNotificationPreference, putNotificationPreference,
} from '@seip/database';

const HHMM = z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/);

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notifications', { config: { operationId: 'listNotifications' } }, async (request) => {
    const auth = request.auth!;
    const q = z.object({
      unread: z.enum(['true', 'false']).optional(),
      cursor: z.string().regex(/^\d+$/).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(request.query);
    const offset = q.cursor ? Number(q.cursor) : 0;
    const page = await listNotifications(auth.userId, { unread: q.unread === 'true', offset, limit: q.limit });
    return {
      items: page.items.map((n) => ({
        id: n.id,
        kind: n.kind,
        title_th: n.titleTh,
        body_th: n.bodyTh,
        entity_type: n.entityType,
        entity_id: n.entityId,
        route: n.route,
        read_at: n.readAt?.toISOString() ?? null,
        created_at: n.createdAt.toISOString(),
      })),
      next_cursor: page.more ? String(offset + q.limit) : null,
      unread_count: page.unread,
    };
  });

  app.post('/notifications/read', { config: { operationId: 'markNotificationsRead' } }, async (request, reply) => {
    const auth = request.auth!;
    const body = z.object({ all: z.boolean().default(false), ids: z.array(z.string().uuid()).max(500).optional() }).parse(request.body ?? {});
    await markNotificationsRead(auth.userId, body.all ? 'all' : (body.ids ?? []));
    reply.status(204).send();
  });

  app.get('/notification-preferences', { config: { operationId: 'getNotificationPreferences' } }, async (request) => {
    const p = await getNotificationPreference(request.auth!.userId);
    return serialize(p);
  });

  app.put('/notification-preferences', { config: { operationId: 'updateNotificationPreferences' } }, async (request) => {
    const body = z.object({
      push: z.boolean(),
      email: z.boolean(),
      quiet_hours: z.object({ start: HHMM, end: HHMM }).nullable().optional(),
    }).parse(request.body);
    const p = await putNotificationPreference(request.auth!.userId, {
      push: body.push, email: body.email, quietStart: body.quiet_hours?.start ?? null, quietEnd: body.quiet_hours?.end ?? null,
    });
    return serialize(p);
  });
};

function serialize(p: { push: boolean; email: boolean; quietStart: string | null; quietEnd: string | null }) {
  return {
    push: p.push,
    email: p.email,
    ...(p.quietStart && p.quietEnd ? { quiet_hours: { start: p.quietStart, end: p.quietEnd } } : {}),
  };
}
