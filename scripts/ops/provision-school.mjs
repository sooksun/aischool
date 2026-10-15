#!/usr/bin/env node
/**
 * provision-school — create a School (and optionally its Area).
 *
 * ## Why this is a CLI and not an API operation (CCR-014 decision 2)
 *
 * permissions.yaml has six roles. Five are `scope: school`. The sixth,
 * area_admin, is `scope: area` and read-only by contract
 * (`writes_by_area_admin: forbidden`, PERM-004, SEC-TEN-3). So no role in the
 * system has cross-school write authority, and school creation has no
 * legitimate caller.
 *
 * Granting one would mean adding a seventh `system_admin` role, which ripples
 * through all 31 matrix rows and widens the permission sweep from 6 roles to 7 —
 * a large, security-sensitive change to serve a rare, slow-changing,
 * operator-level need. Schools are provisioned here instead.
 *
 * Revisit only if multi-school-per-install becomes a real deployment shape.
 *
 * ## Usage
 *   node scripts/ops/provision-school.mjs --code=SCH-001 --name="โรงเรียนตัวอย่าง"
 *   node scripts/ops/provision-school.mjs --code=SCH-001 --name="..." \
 *        --area-code=AREA-1 --area-name="สพป. เขต 1"
 */
import { PrismaClient } from '@prisma/client';

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : undefined;
}

function die(msg) {
  console.error(`provision-school: ${msg}`);
  process.exit(1);
}

const code = arg('code');
const name = arg('name');
const areaCode = arg('area-code');
const areaName = arg('area-name');

if (!code || !name) {
  die('usage: --code=<school code> --name=<school name> [--area-code=<code> --area-name=<name>]');
}
if (areaCode && !areaName) die('--area-code requires --area-name');

const prisma = new PrismaClient();

try {
  const existing = await prisma.school.findUnique({ where: { code }, select: { id: true, name: true } });
  if (existing) {
    // Idempotent: re-running with the same code is a no-op rather than an error,
    // so this is safe to put in a provisioning script that may be re-executed.
    console.log(`\n  school ${code} already exists (${existing.name})`);
    console.log(`  id     ${existing.id}\n`);
    process.exit(0);
  }

  let areaId = null;
  if (areaCode) {
    const area = await prisma.area.upsert({
      where: { code: areaCode },
      update: {},
      create: { code: areaCode, name: areaName },
      select: { id: true, name: true },
    });
    areaId = area.id;
    console.log(`\n  area   ${area.name} (${areaCode})`);
  }

  const school = await prisma.school.create({
    data: { code, name, areaId, status: 'active' },
    select: { id: true },
  });

  console.log(`  school ${name} (${code})`);
  console.log(`  id     ${school.id}`);
  console.log(`\n  Next: node scripts/ops/bootstrap-admin.mjs --email=... --name="..." --school=${code}\n`);
} finally {
  await prisma.$disconnect();
}
