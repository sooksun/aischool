// Operations that are in contract 4.0.0 but not served yet (CCR-017 migration
// plan). Each answers 501 SYS-003 — after authentication, so an anonymous caller
// still gets 401 and nothing about the surface leaks — naming the phase that
// delivers it. Registering them keeps every contract path routed (no stray 404s
// for a client built from the contract) and makes "not built yet" an explicit,
// greppable fact instead of an absence.
import type { FastifyPluginAsync } from 'fastify';
import { ApiError } from '@seip/backend-shared';

type Method = 'get' | 'post' | 'put' | 'delete';
const GATED: [Method, string, string, string][] = [
  // Offline sync and push tokens — P2 (capture once, offline outbox). The device
  // list and revocation are served since SEIP-P1-012 (routes/devices.ts).
  ['get', '/sync/changes', 'getChanges', 'P2'],
  ['put', '/devices/current/push-token', 'registerPushToken', 'P2'],
  ['delete', '/devices/current/push-token', 'removePushToken', 'P2'],
  // Notifications, coverage, committee evidence view — P4
  ['get', '/notifications', 'listNotifications', 'P4'],
  ['post', '/notifications/read', 'markNotificationsRead', 'P4'],
  ['get', '/notification-preferences', 'getNotificationPreferences', 'P4'],
  ['put', '/notification-preferences', 'updateNotificationPreferences', 'P4'],
  // Exports — P5 (DPA pack, PA2 workbook, portability)
  ['get', '/dpa-slot-profiles', 'listDpaSlotProfiles', 'P5'],
  ['get', '/exports', 'listExports', 'P5'],
  ['post', '/exports', 'createExport', 'P5'],
  ['get', '/exports/:exportId', 'getExport', 'P5'],
  ['get', '/exports/:exportId/download-url', 'getExportDownloadUrl', 'P5'],
];

export const PHASE_GATED_OPERATIONS = GATED.map(([, , op]) => op);
export const PHASE_GATED_ROUTES: readonly (readonly [Method, string, string, string])[] = GATED;

export const phaseGatedRoutes: FastifyPluginAsync = async (app) => {
  for (const [method, path, operationId, phase] of GATED) {
    app[method](path, { config: { operationId } }, async () => {
      throw new ApiError('SYS-003', `${operationId} is in contract 4.0.0 but not served until ${phase} (CCR-017)`);
    });
  }
};
