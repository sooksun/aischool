// Ensures deterministic teacher + director accounts for Playwright (SEIP-QA-004+).
// Requires DATABASE_URL and a migrated DB (seed taxonomy recommended).
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_STATE = resolve(__dirname, '.auth/e2e-user.json');

const E2E_TEACHER_EMAIL = process.env.E2E_TEACHER_EMAIL ?? 'e2e-teacher@seip.local';
const E2E_TEACHER_PASSWORD = process.env.E2E_TEACHER_PASSWORD ?? 'e2e-teacher-password-1234';
const E2E_DIRECTOR_EMAIL = process.env.E2E_DIRECTOR_EMAIL ?? 'e2e-director@seip.local';
const E2E_DIRECTOR_PASSWORD = process.env.E2E_DIRECTOR_PASSWORD ?? 'e2e-director-password-1234';

async function ensureUser(prisma, {
  email, password, displayName, schoolId, role, withPersonnel,
}) {
  let user = await prisma.userAccount.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.userAccount.create({
      data: {
        email,
        displayName,
        status: 'active',
        passwordHash: await argonHash(password),
      },
    });
  } else {
    await prisma.userAccount.update({
      where: { id: user.id },
      data: { passwordHash: await argonHash(password), status: 'active' },
    });
  }

  const membership = await prisma.schoolMembership.findFirst({
    where: { userId: user.id, schoolId, role },
  });
  if (!membership) {
    await prisma.schoolMembership.create({
      data: {
        userId: user.id,
        schoolId,
        role,
        membershipScope: 'school',
        effectiveFrom: new Date('2020-01-01'),
        status: 'active',
      },
    });
  }

  if (withPersonnel) {
    const personnel = await prisma.personnelProfile.findFirst({
      where: { userId: user.id, schoolId },
    });
    if (!personnel) {
      await prisma.personnelProfile.create({
        data: {
          schoolId,
          userId: user.id,
          fullName: displayName,
          positionRole: 'teacher',
          rankLevelCode: 'apply_adapt',
        },
      });
    }
  }

  return user;
}

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

    await ensureUser(prisma, {
      email: E2E_TEACHER_EMAIL,
      password: E2E_TEACHER_PASSWORD,
      displayName: 'E2E Teacher',
      schoolId: school.id,
      role: 'teacher',
      withPersonnel: true,
    });

    await ensureUser(prisma, {
      email: E2E_DIRECTOR_EMAIL,
      password: E2E_DIRECTOR_PASSWORD,
      displayName: 'E2E Director',
      schoolId: school.id,
      role: 'director',
      withPersonnel: true,
    });

    // Optional open cycle for director UI smoke (idempotent by title tag)
    const fw = await prisma.frameworkVersion.findFirst({
      where: { status: 'active', roleFamily: 'teacher' },
      orderBy: { revisionYear: 'desc' },
    });
    if (fw) {
      const existing = await prisma.evaluationCycle.findFirst({
        where: { schoolId: school.id, title: 'E2E Smoke Cycle' },
      });
      if (!existing) {
        await prisma.evaluationCycle.create({
          data: {
            schoolId: school.id,
            frameworkVersionId: fw.id,
            fiscalYear: 2569,
            evaluationKind: 'pa',
            title: 'E2E Smoke Cycle',
            status: 'open',
            startsOn: new Date('2026-01-01'),
            endsOn: new Date('2026-12-31'),
          },
        });
      }
    }

    mkdirSync(dirname(AUTH_STATE), { recursive: true });
    writeFileSync(AUTH_STATE, JSON.stringify({
      teacher: { email: E2E_TEACHER_EMAIL, password: E2E_TEACHER_PASSWORD },
      director: { email: E2E_DIRECTOR_EMAIL, password: E2E_DIRECTOR_PASSWORD },
      schoolId: school.id,
      createdAt: new Date().toISOString(),
      note: `fixture id ${randomUUID().slice(0, 8)}`,
    }, null, 2));

    console.log('[e2e setup] teacher + director ready');
  } finally {
    await prisma.$disconnect();
  }
}
