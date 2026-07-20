// Deterministic fixtures for Playwright depth e2e (SEIP-QA-004 / cleanup L2).
// Requires DATABASE_URL + a migrated DB (seed taxonomy recommended) AND a running
// API — see E2E_API_URL below.
// Does NOT require the worker: ready report payload is written directly for PDF tests.
//
// WHICH FIXTURES MAY WRITE DIRECTLY, AND WHY (keep this list honest — the
// 2026-07-19 audit found a green suite hiding an unusable product because a
// direct write manufactured a row the product itself could not create):
//   - identity (users, school, memberships, personnel) — stands in for
//     scripts/ops/bootstrap-admin.mjs, which is an operator CLI by design
//     (CCR-014 decision 1). Everything after the first admin goes through HTTP.
//   - cycle, round, assignment, ready report payload — scaffolding for the flows
//     under test, all of which DO have working operations; converting them is
//     desirable but not load-bearing for any known blocker.
//   - PerformanceAgreement — NO LONGER. It goes through the API since CCR-015.
//     That one row was SEIP-BLOCK-002: nothing in the product could create it, so
//     writing it here made the whole scoring path look reachable when it was not.
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
const E2E_EVAL2_EMAIL = process.env.E2E_EVAL2_EMAIL ?? 'e2e-eval2@seip.local';
const E2E_EVAL2_PASSWORD = process.env.E2E_EVAL2_PASSWORD ?? 'e2e-eval2-password-1234';
const E2E_EVAL3_EMAIL = process.env.E2E_EVAL3_EMAIL ?? 'e2e-eval3@seip.local';
const E2E_EVAL3_PASSWORD = process.env.E2E_EVAL3_PASSWORD ?? 'e2e-eval3-password-1234';
// CCR-014. Stands in for `scripts/ops/bootstrap-admin.mjs` — the one identity
// that is legitimately created outside the API, because bootstrapping the first
// admin is a CLI by design (CCR-014 decision 1). Everyone the onboarding spec
// creates goes through HTTP from here on.
const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@seip.local';
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password-1234';

// The API the fixtures talk to. Defaults to the port .env.example ships and the
// Vite dev proxy targets; CI can override.
const E2E_API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3011/api/v1';

async function apiLogin(email, password) {
  const res = await fetch(`${E2E_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    // Fail loudly. A silent fallback to a direct DB write is exactly what let a
    // green suite hide an unusable product (docs/qa/QUALITY-GATES.md § caveats).
    throw new Error(
      `[e2e setup] login failed for ${email} (${res.status}). Is the API running on ${E2E_API_URL}? ` +
      'Fixtures go through HTTP on purpose since CCR-015 — they must not fall back to Prisma.',
    );
  }
  return (await res.json()).access_token;
}

async function apiPost(token, path, body) {
  const res = await fetch(`${E2E_API_URL}${path}`, {
    method: 'POST',
    // content-type only when there IS a body: Fastify rejects an empty body that
    // declares application/json (FST_ERR_CTP_EMPTY_JSON_BODY), and several of
    // these operations (submit, acknowledge) legitimately take none.
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`[e2e setup] POST ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function ensureUser(prisma, {
  email, password, displayName, schoolId, role, withPersonnel, positionRole = 'teacher',
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

  let personnelId = null;
  if (withPersonnel) {
    let personnel = await prisma.personnelProfile.findFirst({
      where: { userId: user.id, schoolId },
    });
    if (!personnel) {
      personnel = await prisma.personnelProfile.create({
        data: {
          schoolId,
          userId: user.id,
          fullName: displayName,
          positionRole,
          rankLevelCode: 'apply_adapt',
        },
      });
    }
    personnelId = personnel.id;
  }

  return { user, personnelId };
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

    const teacher = await ensureUser(prisma, {
      email: E2E_TEACHER_EMAIL,
      password: E2E_TEACHER_PASSWORD,
      displayName: 'E2E Teacher',
      schoolId: school.id,
      role: 'teacher',
      withPersonnel: true,
      positionRole: 'teacher',
    });

    const director = await ensureUser(prisma, {
      email: E2E_DIRECTOR_EMAIL,
      password: E2E_DIRECTOR_PASSWORD,
      displayName: 'E2E Director',
      schoolId: school.id,
      role: 'director',
      withPersonnel: true,
      positionRole: 'teacher',
    });

    await ensureUser(prisma, {
      email: E2E_ADMIN_EMAIL,
      password: E2E_ADMIN_PASSWORD,
      displayName: 'E2E Admin',
      schoolId: school.id,
      role: 'school_admin',
      withPersonnel: false,
    });

    const eval2 = await ensureUser(prisma, {
      email: E2E_EVAL2_EMAIL,
      password: E2E_EVAL2_PASSWORD,
      displayName: 'E2E Eval 2',
      schoolId: school.id,
      role: 'evaluator',
      withPersonnel: false,
    });

    const eval3 = await ensureUser(prisma, {
      email: E2E_EVAL3_EMAIL,
      password: E2E_EVAL3_PASSWORD,
      displayName: 'E2E Eval 3',
      schoolId: school.id,
      role: 'evaluator',
      withPersonnel: false,
    });

    let cycleId = null;
    let roundId = null;
    let assignmentId = null;
    let readyReportId = null;

    // Selected BY CODE, not by "newest active teacher framework".
    //
    // The old query was a guess that happened to work. Every leftover
    // `frameworkVersion` an integration suite creates with status `active` and
    // revisionYear 2564 ties with the real one, so the winner was whichever row
    // the database returned first — and on 2026-07-20 that was a 3-indicator
    // `rpt-fw-*` fixture with no challenge indicator. The whole e2e run silently
    // moved onto a framework that is not the product's, and only failed later,
    // deep in agreement creation, with "framework has no challenge indicator".
    //
    // e2e exists to exercise the seeded ว9/2564 taxonomy (ADR-0003). Naming it
    // makes that explicit and makes a missing seed fail here, with a sentence
    // saying what to run, instead of somewhere downstream.
    const fw = await prisma.frameworkVersion.findUnique({
      where: { code: 'v9-2564-teacher' },
    });
    if (!fw) {
      throw new Error(
        '[e2e setup] framework `v9-2564-teacher` not found — run `npm run db:seed` '
        + '(ADR-0003: the taxonomy is seed data, never hard-coded)',
      );
    }

    if (fw && teacher.personnelId) {
      let cycle = await prisma.evaluationCycle.findFirst({
        where: { schoolId: school.id, title: 'E2E Smoke Cycle' },
      });
      if (!cycle) {
        cycle = await prisma.evaluationCycle.create({
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
      cycleId = cycle.id;

      let round = await prisma.evaluationRound.findFirst({
        where: { cycleId: cycle.id, roundNumber: 1 },
      });
      if (!round) {
        round = await prisma.evaluationRound.create({
          data: {
            cycleId: cycle.id,
            roundNumber: 1,
            purpose: 'E2E scoring round',
            status: 'open',
            periodStart: new Date('2026-02-01'),
            periodEnd: new Date('2026-11-30'),
          },
        });
      } else if (round.status === 'planned' || round.status === 'closed') {
        round = await prisma.evaluationRound.update({
          where: { id: round.id },
          data: { status: 'open' },
        });
      }
      roundId = round.id;

      // CCR-015: created through the HTTP API, not `prisma.performanceAgreement
      // .create(...)`. The direct write that used to live here is why a fully
      // green e2e run coexisted with a system where no score could be submitted
      // through the API at all — the fixture manufactured the one row the product
      // could not. Going through the real operations means this setup now fails
      // loudly if agreements break, instead of papering over them.
      let agreement = await prisma.performanceAgreement.findFirst({
        where: { schoolId: school.id, cycleId: cycle.id, personnelId: teacher.personnelId },
      });
      if (!agreement) {
        const teacherToken = await apiLogin(E2E_TEACHER_EMAIL, E2E_TEACHER_PASSWORD);
        const created = await apiPost(teacherToken, '/agreements', {
          cycle_id: cycle.id,
          personnel_id: teacher.personnelId,
          challenge: {
            title: 'ยกระดับผลสัมฤทธิ์การอ่านของนักเรียนชั้น ป.3',
            method_plan: 'ใช้ชุดกิจกรรมการอ่านเชิงรุกสัปดาห์ละ 2 คาบ ควบคู่กับการวัดผลรายบุคคล',
            quantitative_target: 'นักเรียนร้อยละ 80 มีคะแนนการอ่านเพิ่มขึ้นอย่างน้อย 10%',
            qualitative_target: 'นักเรียนมีเจตคติที่ดีต่อการอ่านและเลือกหนังสืออ่านเองได้',
          },
        });
        await apiPost(teacherToken, `/agreements/${created.id}/submit`);
        agreement = await prisma.performanceAgreement.findUnique({ where: { id: created.id } });
      }

      let assignment = await prisma.evaluationAssignment.findFirst({
        where: {
          schoolId: school.id,
          roundId: round.id,
          evaluateePersonnelId: teacher.personnelId,
        },
        include: { committee: true },
      });
      if (!assignment) {
        assignment = await prisma.evaluationAssignment.create({
          data: {
            schoolId: school.id,
            roundId: round.id,
            evaluateePersonnelId: teacher.personnelId,
            agreementId: agreement.id,
            status: 'in_progress',
            committee: {
              createMany: {
                data: [
                  { evaluatorUserId: director.user.id, committeeRole: 'chair', seatNumber: 1 },
                  { evaluatorUserId: eval2.user.id, committeeRole: 'member', seatNumber: 2 },
                  { evaluatorUserId: eval3.user.id, committeeRole: 'member', seatNumber: 3 },
                ],
              },
            },
          },
        });
      }
      // Repair a pre-existing assignment that is not linked to the current
      // agreement. Without this the fixture is only correct on a virgin database:
      // an assignment created in an earlier run keeps whatever agreementId it had,
      // and a null one makes every scoring test fail at SCORE-004 with no hint as
      // to why. Found exactly that way while converting this file to HTTP.
      if (assignment.agreementId !== agreement.id) {
        assignment = await prisma.evaluationAssignment.update({
          where: { id: assignment.id },
          data: { agreementId: agreement.id },
          include: { committee: true },
        });
      }
      assignmentId = assignment.id;

      // Ready report for PDF download without worker (cleanup L2).
      let report = await prisma.report.findFirst({
        where: { schoolId: school.id, templateCode: 'PA2_s', subjectPersonnelId: teacher.personnelId },
      });
      const readyPayload = {
        schema_version: 1,
        generation_status: 'ready',
        template_code: 'PA2_s',
        subject: {
          personnel_id: teacher.personnelId,
          full_name: 'E2E Teacher',
          position_role: 'teacher',
          rank_level_code: 'apply_adapt',
        },
        cycle: {
          id: cycle.id,
          title: cycle.title,
          fiscal_year: cycle.fiscalYear,
          evaluation_kind: cycle.evaluationKind,
          framework_code: fw.code,
          framework_legal_ref: fw.legalRef,
        },
        round: {
          id: round.id,
          round_number: round.roundNumber,
          purpose: round.purpose,
          status: round.status,
        },
        confirmed_mappings: [],
        assignments: [],
        generated_at: new Date().toISOString(),
      };
      if (!report) {
        report = await prisma.report.create({
          data: {
            schoolId: school.id,
            cycleId: cycle.id,
            roundId: round.id,
            subjectPersonnelId: teacher.personnelId,
            templateCode: 'PA2_s',
            status: 'pending_approval',
            payload: readyPayload,
            generatedAt: new Date(),
          },
        });
      } else if (report.status === 'draft') {
        report = await prisma.report.update({
          where: { id: report.id },
          data: {
            status: 'pending_approval',
            payload: readyPayload,
            generatedAt: new Date(),
          },
        });
      }
      readyReportId = report.id;
    }

    mkdirSync(dirname(AUTH_STATE), { recursive: true });
    writeFileSync(AUTH_STATE, JSON.stringify({
      teacher: { email: E2E_TEACHER_EMAIL, password: E2E_TEACHER_PASSWORD },
      director: { email: E2E_DIRECTOR_EMAIL, password: E2E_DIRECTOR_PASSWORD },
      admin: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
      schoolId: school.id,
      teacherPersonnelId: teacher.personnelId,
      cycleId,
      roundId,
      assignmentId,
      readyReportId,
      createdAt: new Date().toISOString(),
      note: `fixture id ${randomUUID().slice(0, 8)}`,
    }, null, 2));

    console.log('[e2e setup] teacher + director + committee + ready report');
  } finally {
    await prisma.$disconnect();
  }
}
