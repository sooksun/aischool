// Browser sessions behind the BFF (CCR-018, ADR-0014 §4). The API hashes the
// cookie value before it gets here; this layer never sees a raw cookie.
import { prisma } from '../client.js';

/** ADR-0014 §4: a session ends after 30 minutes without a request. */
export const WEB_SESSION_IDLE_MS = 30 * 60 * 1000;
/** ADR-0014 §4: and after 8 hours whatever happens. */
export const WEB_SESSION_MAX_MS = 8 * 60 * 60 * 1000;
/** lastSeenAt is written at most this often, not on every request. */
const TOUCH_EVERY_MS = 60 * 1000;

export interface NewWebSession {
  userId: string;
  tokenHash: string;
  csrfHash: string;
  acr: number;
  kcSessionId: string | null;
  kcRefreshToken: string;
  kcCheckDueAt: Date;
}

export async function createWebSession(input: NewWebSession, now = new Date()) {
  return prisma.webSession.create({
    data: { ...input, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + WEB_SESSION_MAX_MS) },
  });
}

/** The live session for a cookie hash: not revoked, not past 8 h, not idle 30 min. */
export async function getLiveWebSession(tokenHash: string, now = new Date()) {
  return prisma.webSession.findFirst({
    where: {
      tokenHash, revokedAt: null, expiresAt: { gt: now },
      lastSeenAt: { gt: new Date(now.getTime() - WEB_SESSION_IDLE_MS) },
    },
  });
}

export async function touchWebSession(session: { id: string; lastSeenAt: Date }, now = new Date()) {
  if (now.getTime() - session.lastSeenAt.getTime() < TOUCH_EVERY_MS) return;
  await prisma.webSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
}

/**
 * One request per session wins the right to check Keycloak; the rest carry on.
 * The winner pushes kcCheckDueAt out by `leaseMs` so a slow check is not repeated
 * by every request in the meantime.
 */
export async function claimKeycloakCheck(id: string, leaseMs: number, now = new Date()): Promise<boolean> {
  const { count } = await prisma.webSession.updateMany({
    where: { id, revokedAt: null, kcCheckDueAt: { lte: now } },
    data: { kcCheckDueAt: new Date(now.getTime() + leaseMs) },
  });
  return count === 1;
}

export async function recordKeycloakCheck(id: string, kcRefreshToken: string, nextDueAt: Date) {
  await prisma.webSession.update({ where: { id }, data: { kcRefreshToken, kcCheckDueAt: nextDueAt } });
}

export async function revokeWebSession(id: string, now = new Date()) {
  await prisma.webSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
}

/** The session row for a cookie hash whatever its state — for logout. */
export async function getWebSessionByTokenHash(tokenHash: string) {
  return prisma.webSession.findUnique({ where: { tokenHash } });
}
