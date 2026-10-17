// FR-099 / CCR-022: one-time password resets. Issuing cancels any earlier unused
// reset for the account; redeeming sets the password and ends every session the
// account has here, in one transaction.
import { prisma } from '../client.js';
import { writeAuditEvent } from '../audit.js';

export async function issuePasswordResetRow(input: {
  userId: string; schoolId: string; issuedByUserId: string; tokenHash: string; expiresAt: Date; requestId: string;
}, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.passwordReset.updateMany({ where: { userId: input.userId, usedAt: null }, data: { usedAt: now } });
    const row = await tx.passwordReset.create({
      data: {
        userId: input.userId, schoolId: input.schoolId, issuedByUserId: input.issuedByUserId,
        tokenHash: input.tokenHash, createdAt: now, expiresAt: input.expiresAt,
      },
    });
    await writeAuditEvent({
      schoolId: input.schoolId, actorUserId: input.issuedByUserId, action: 'password_reset_issued',
      entityType: 'UserAccount', entityId: input.userId, requestId: input.requestId,
    }, tx);
    return row;
  });
}

/**
 * Spends the token and sets the password. Null when the token is unknown,
 * expired or used — one answer for all three (AUTH-008). The compare-and-swap
 * on used_at means two concurrent redemptions cannot both succeed.
 */
export async function redeemPasswordReset(tokenHash: string, passwordHash: string, requestId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.passwordReset.findUnique({ where: { tokenHash } });
    if (!row) return null;
    const spent = await tx.passwordReset.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
    });
    if (spent.count === 0) return null;
    await tx.userAccount.update({ where: { id: row.userId }, data: { passwordHash } });
    await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.webSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
    const devices = await tx.deviceSession.findMany({ where: { userId: row.userId, revokedAt: null }, select: { kcSessionId: true } });
    await tx.deviceSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
    await writeAuditEvent({
      schoolId: row.schoolId, actorUserId: row.userId, action: 'password_reset_completed',
      entityType: 'UserAccount', entityId: row.userId, requestId,
    }, tx);
    return { userId: row.userId, kcSessionIds: devices.map((d) => d.kcSessionId) };
  });
}
