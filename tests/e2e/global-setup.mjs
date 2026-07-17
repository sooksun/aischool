// Ensures a deterministic teacher account exists for Playwright smoke (SEIP-QA-004).
// Requires DATABASE_URL and a migrated DB (seed taxonomy optional but recommended).
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_STATE = resolve(__dirname, '.auth/e2e-user.json');

const E2E_EMAIL = process.env.E2E_TEACHER_EMAIL ?? 'e2e-teacher@seip.local';
const E2E_PASSWORD = process.env.E2E_TEACHER_PASSWORD ?? 'e2e-teacher-password-1234';

export default async function globalSetup() {
  const prisma = new PrismaClient();
  try {
    await prisma.rankLevel.upsert({
      where: { code: 'apply_adapt' },
      create: {
        code: 'apply_adapt',
        roleFamily: 'teacher',
        labelTh: 'Apply & Adapt (ครู)',
        sortOrder: 2,
      },
      update: {},
    });

    let school = await prisma.school.findFirst({ where: { code: 'e2e-school' } });
    if (!school) {
      school = await prisma.school.create({
        data: { code: 'e2e-school', name: 'E2E Test School' },
      });
    }

    let user = await prisma.userAccount.findUnique({ where: { email: E2E_EMAIL } });
    if (!user) {
      user = await prisma.userAccount.create({
        data: {
          email: E2E_EMAIL,
          displayName: 'E2E Teacher',
          status: 'active',
          passwordHash: await argonHash(E2E_PASSWORD),
        },
      });
    } else {
      await prisma.userAccount.update({
        where: { id: user.id },
        data: { passwordHash: await argonHash(E2E_PASSWORD), status: 'active' },
      });
    }

    const membership = await prisma.schoolMembership.findFirst({
      where: { userId: user.id, schoolId: school.id, role: 'teacher' },
    });
    if (!membership) {
      await prisma.schoolMembership.create({
        data: {
          userId: user.id,
          schoolId: school.id,
          role: 'teacher',
          membershipScope: 'school',
          effectiveFrom: new Date('2020-01-01'),
          status: 'active',
        },
      });
    }

    const personnel = await prisma.personnelProfile.findFirst({
      where: { userId: user.id, schoolId: school.id },
    });
    if (!personnel) {
      await prisma.personnelProfile.create({
        data: {
          schoolId: school.id,
          userId: user.id,
          fullName: 'E2E Teacher',
          positionRole: 'teacher',
          rankLevelCode: 'apply_adapt',
        },
      });
    }

    mkdirSync(dirname(AUTH_STATE), { recursive: true });
    writeFileSync(AUTH_STATE, JSON.stringify({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      schoolId: school.id,
      createdAt: new Date().toISOString(),
      note: `fixture id ${randomUUID().slice(0, 8)}`,
    }, null, 2));

    console.log('[e2e setup] teacher ready:', E2E_EMAIL);
  } finally {
    await prisma.$disconnect();
  }
}
