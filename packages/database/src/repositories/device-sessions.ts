// FR-093: the caller's sessions — app sign-ins (device_session) and browser
// sessions (web_session) — listed together and revoked one at a time.
import { prisma } from '../client.js';
import { WEB_SESSION_IDLE_MS } from './web-sessions.js';

const TOUCH_EVERY_MS = 60_000;

/**
 * The row for an app token's Keycloak session, created on first sight. Null when
 * that session was revoked here: its tokens are refused from then on, even the
 * access token still inside its 60 s.
 */
export async function seeDeviceSession(
  input: { userId: string; kcSessionId: string; platform: 'android' | 'ios'; appVersion: string | null }, now = new Date(),
) {
  const row = await prisma.deviceSession.upsert({
    where: { kcSessionId: input.kcSessionId },
    create: { ...input, createdAt: now, lastSeenAt: now },
    update: {},
  });
  // A Keycloak session id names one user; a token for another is not this session.
  if (row.userId !== input.userId || row.revokedAt) return null;
  if (now.getTime() - row.lastSeenAt.getTime() >= TOUCH_EVERY_MS) {
    await prisma.deviceSession.update({ where: { id: row.id }, data: { lastSeenAt: now, appVersion: input.appVersion ?? row.appVersion } });
  }
  return row;
}

export async function listSessionsForUser(userId: string, now = new Date()) {
  const [devices, web] = await Promise.all([
    prisma.deviceSession.findMany({ where: { userId, revokedAt: null }, orderBy: { lastSeenAt: 'desc' } }),
    prisma.webSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - WEB_SESSION_IDLE_MS) } },
      orderBy: { lastSeenAt: 'desc' },
    }),
  ]);
  return { devices, web };
}

/** The caller's own live session by id, from either table; null otherwise. */
export async function findOwnSession(userId: string, id: string) {
  const device = await prisma.deviceSession.findFirst({ where: { id, userId, revokedAt: null } });
  if (device) return { kind: 'device' as const, row: device };
  const web = await prisma.webSession.findFirst({ where: { id, userId, revokedAt: null } });
  if (web) return { kind: 'web' as const, row: web };
  return null;
}

export async function revokeDeviceSessionRow(id: string, now = new Date()) {
  await prisma.deviceSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now, pushProvider: null, pushToken: null } });
}

/** FR-100: bind (or replace) the push token of the caller's own, live app session. False if it is not one. */
export async function setDevicePushToken(userId: string, sessionId: string, value: { provider: 'fcm' | 'apns'; token: string } | null) {
  const r = await prisma.deviceSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { pushProvider: value?.provider ?? null, pushToken: value?.token ?? null },
  });
  return r.count > 0;
}
