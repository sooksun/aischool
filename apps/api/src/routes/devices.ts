// FR-093: the caller's sessions — each app sign-in and each browser session —
// and revoking one. Self-scoped (permissions.yaml any_authenticated): another
// person's session id is RES-001, like a missing one.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { listSessionsForUser, findOwnSession, revokeDeviceSessionRow, revokeWebSession, writeAuditEvent } from '@seip/database';
import { ApiError } from '@seip/backend-shared';
import type { Keycloak } from '../lib/keycloak.js';

export const deviceRoutes: FastifyPluginAsync<{ keycloak: Keycloak | null }> = async (app, { keycloak }) => {
  app.get('/devices', { config: { operationId: 'listDeviceSessions' } }, async (request) => {
    const auth = request.auth!;
    const { devices, web } = await listSessionsForUser(auth.userId);
    return [
      ...devices.map((d) => ({
        id: d.id, platform: d.platform, app_version: d.appVersion, label: null,
        created_at: d.createdAt.toISOString(), last_seen_at: d.lastSeenAt.toISOString(),
        current: d.id === auth.sessionId, has_push: false,
      })),
      ...web.map((w) => ({
        id: w.id, platform: 'web', app_version: null, label: null,
        created_at: w.createdAt.toISOString(), last_seen_at: w.lastSeenAt.toISOString(),
        current: w.id === auth.sessionId, has_push: false,
      })),
    ].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
  });

  app.delete('/devices/:deviceSessionId', { config: { operationId: 'revokeDeviceSession' } }, async (request, reply) => {
    const auth = request.auth!;
    const { deviceSessionId } = z.object({ deviceSessionId: z.string().uuid() }).parse(request.params);
    const found = await findOwnSession(auth.userId, deviceSessionId);
    if (!found) throw new ApiError('RES-001', 'Session not found');

    // Refused here first, so the revocation holds even if Keycloak is down; the
    // Keycloak session is then deleted so the app cannot even renew.
    if (found.kind === 'device') await revokeDeviceSessionRow(found.row.id);
    else await revokeWebSession(found.row.id);
    const kcSessionId = found.row.kcSessionId;
    if (kcSessionId && keycloak?.provisioner) {
      await keycloak.provisioner.endSession(kcSessionId, found.kind === 'device').catch((err) => {
        request.log.warn({ err }, 'revokeDeviceSession: keycloak session not deleted');
      });
    }
    await writeAuditEvent({
      schoolId: null, actorUserId: auth.userId, action: 'revoked',
      entityType: found.kind === 'device' ? 'DeviceSession' : 'WebSession', entityId: found.row.id, requestId: request.id,
    });
    return reply.code(204).send();
  });
};
