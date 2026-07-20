#!/usr/bin/env node
/**
 * bootstrap-admin — create the first school_admin so a fresh install can be
 * logged into (CCR-014 decision 1, SEIP-BLOCK-001).
 *
 * ## Why this is a CLI and not an API operation
 *
 * Three options were weighed in CCR-014:
 *   A. seed a default admin with a known password — ships a credential that is
 *      in git and that on-prem operators demonstrably never change;
 *   B. this CLI — needs DB access, an authority that already implies total
 *      control, so it grants nothing the operator did not already have;
 *   C. a self-disabling `POST /bootstrap` — a permanently public write endpoint
 *      whose safety is a runtime row count, which is wrong in exactly the
 *      situations that matter (a restore that left the DB empty, a freshly
 *      provisioned tenant).
 *
 * B was chosen. The consequence is that bootstrap is deliberately OUTSIDE
 * openapi.yaml: there is no HTTP path to this, by design.
 *
 * ## Usage
 *   node scripts/ops/bootstrap-admin.mjs --email=a@b.th --name="ชื่อ" --school=SCH-001
 *   SEIP_ADMIN_PASSWORD=... node scripts/ops/bootstrap-admin.mjs ...
 *
 * The password is read from SEIP_ADMIN_PASSWORD, never from a flag — argv is
 * visible to every process on the box via `ps` and lands in shell history.
 * Omit it and one is generated and printed once.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@seip/auth';
import { randomBytes } from 'node:crypto';

const MIN_PASSWORD_LENGTH = 12;

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : undefined;
}

function die(msg) {
  console.error(`bootstrap-admin: ${msg}`);
  process.exit(1);
}

const email = arg('email')?.toLowerCase();
const displayName = arg('name');
const schoolCode = arg('school');

if (!email || !displayName || !schoolCode) {
  die('usage: --email=<email> --name=<display name> --school=<school code>\n' +
      '       password comes from $SEIP_ADMIN_PASSWORD (generated if unset)');
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die(`not an email: ${email}`);

let password = process.env.SEIP_ADMIN_PASSWORD;
let generated = false;
if (!password) {
  // 32 base64url chars ≈ 192 bits. Printed once, never stored in plaintext.
  password = randomBytes(24).toString('base64url');
  generated = true;
} else if (password.length < MIN_PASSWORD_LENGTH) {
  die(`SEIP_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (matches the invite-accept policy)`);
}

const prisma = new PrismaClient();

try {
  const school = await prisma.school.findUnique({ where: { code: schoolCode }, select: { id: true, name: true } });
  if (!school) {
    die(`no school with code '${schoolCode}'. Create one first:\n` +
        `       node scripts/ops/provision-school.mjs --code=${schoolCode} --name="..."`);
  }

  const existing = await prisma.userAccount.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  if (existing?.passwordHash) {
    // Refuse rather than reset. This script runs with full DB rights, so it
    // COULD overwrite the hash — but then "bootstrap" would double as a silent
    // password-reset tool for any account, which is precisely the capability
    // CCR-014 kept out of inviteMember. Recovery is a deliberate, separate act.
    die(`${email} already has a password. This tool creates the FIRST admin; it does not reset credentials.`);
  }

  const passwordHash = await hashPassword(password);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { userId, membershipId } = await prisma.$transaction(async (tx) => {
    const user = existing
      ? await tx.userAccount.update({
          where: { id: existing.id },
          data: { passwordHash, status: 'active', displayName, inviteTokenHash: null, inviteExpiresAt: null },
          select: { id: true },
        })
      : await tx.userAccount.create({
          data: { email, displayName, passwordHash, status: 'active' },
          select: { id: true },
        });

    const clash = await tx.schoolMembership.findFirst({
      where: { userId: user.id, schoolId: school.id, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
      select: { id: true },
    });
    if (clash) return { userId: user.id, membershipId: clash.id };

    const membership = await tx.schoolMembership.create({
      data: {
        userId: user.id,
        schoolId: school.id,
        role: 'school_admin',
        membershipScope: 'school',
        effectiveFrom: today,
        status: 'active',
      },
      select: { id: true },
    });

    await tx.auditEvent.create({
      data: {
        schoolId: school.id,
        actorUserId: user.id, // self-granted: there is no prior admin to attribute this to
        action: 'bootstrap_admin_created',
        entityType: 'SchoolMembership',
        entityId: membership.id,
        afterState: { id: membership.id, userId: user.id, schoolId: school.id, role: 'school_admin', status: 'active' },
      },
    });

    return { userId: user.id, membershipId: membership.id };
  });

  console.log(`\n  school      ${school.name} (${schoolCode})`);
  console.log(`  admin       ${email}`);
  console.log(`  user id     ${userId}`);
  console.log(`  membership  ${membershipId}`);
  if (generated) {
    console.log(`\n  PASSWORD    ${password}`);
    console.log('  ^ shown once and not recoverable. Store it, then change it.');
  }
  console.log('\n  This admin can now log in and invite everyone else via POST /members.\n');
} finally {
  await prisma.$disconnect();
}
