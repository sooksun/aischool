// Integration: createReport + report.generate worker + suggestMappings (local_heuristic).
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';
import { runOnce } from '../../worker/dist/loop.js';
import { S3Client } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
let app;
let env;
let school;
let teacherToken;
let directorToken;
let teacherPersonnelId;
let frameworkId;
let cycleId;
let evidenceId;
let indicatorIds = [];

const fakeS3 = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || 'http://127.0.0.1:9000',
  forcePathStyle: true,
  credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
});

before(async () => {
  ({ app, env } = await buildServer());
  await app.ready();

  const area = await prisma.area.create({
    data: { code: `rpt-area-${randomUUID()}`, name: 'Area' },
  });
  school = await prisma.school.create({
    data: { code: `rpt-school-${randomUUID()}`, name: 'School', areaId: area.id },
  });
  await prisma.rankLevel.upsert({
    where: { code: 'teacher_kru' },
    create: { code: 'teacher_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 1 },
    update: {},
  });

  const teacherPass = 'teacher-pass-1234';
  const teacher = await prisma.userAccount.create({
    data: {
      email: `rpt-teacher-${randomUUID()}@x.io`,
      displayName: 'Teacher',
      status: 'active',
      passwordHash: await argonHash(teacherPass),
    },
  });
  await prisma.schoolMembership.create({
    data: {
      userId: teacher.id,
      schoolId: school.id,
      role: 'teacher',
      membershipScope: 'school',
      effectiveFrom: new Date('2020-01-01'),
      status: 'active',
    },
  });
  const personnel = await prisma.personnelProfile.create({
    data: {
      schoolId: school.id,
      userId: teacher.id,
      fullName: 'ครูทดสอบ',
      positionRole: 'teacher',
      rankLevelCode: 'teacher_kru',
    },
  });
  teacherPersonnelId = personnel.id;

  const directorPass = 'director-pass-1234';
  const director = await prisma.userAccount.create({
    data: {
      email: `rpt-director-${randomUUID()}@x.io`,
      displayName: 'Director',
      status: 'active',
      passwordHash: await argonHash(directorPass),
    },
  });
  await prisma.schoolMembership.create({
    data: {
      userId: director.id,
      schoolId: school.id,
      role: 'director',
      membershipScope: 'school',
      effectiveFrom: new Date('2020-01-01'),
      status: 'active',
    },
  });

  const tLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: teacher.email, password: teacherPass },
  });
  teacherToken = tLogin.json().access_token;
  const dLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: director.email, password: directorPass },
  });
  directorToken = dLogin.json().access_token;

  const fw = await prisma.frameworkVersion.create({
    data: {
      code: `rpt-fw-${randomUUID()}`,
      roleFamily: 'teacher',
      legalRef: 'test',
      revisionYear: 2564,
      status: 'active',
      effectiveFrom: new Date(),
    },
  });
  frameworkId = fw.id;
  const domain = await prisma.evaluationDomain.create({
    data: {
      frameworkVersionId: fw.id,
      code: `D-${randomUUID().slice(0, 8)}`,
      nameTh: 'การจัดการเรียนรู้',
      sortOrder: 1,
      part: 'standards',
    },
  });
  for (const [code, nameTh] of [
    ['T-1.1', 'การจัดการเรียนรู้ Active Learning'],
    ['T-1.2', 'การวัดและประเมินผล'],
    ['T-2.1', 'การพัฒนาตนเอง'],
  ]) {
    const ind = await prisma.indicator.create({
      data: {
        domainId: domain.id,
        frameworkVersionId: fw.id,
        code: `${code}-${randomUUID().slice(0, 4)}`,
        nameTh,
        sortOrder: indicatorIds.length + 1,
        isScored: true,
        indicatorKind: 'standard',
      },
    });
    indicatorIds.push(ind.id);
  }

  const cycle = await prisma.evaluationCycle.create({
    data: {
      schoolId: school.id,
      frameworkVersionId: fw.id,
      fiscalYear: 2569,
      evaluationKind: 'pa',
      title: 'รอบทดสอบรายงาน',
      startsOn: new Date('2026-01-01'),
      endsOn: new Date('2026-12-31'),
    },
  });
  cycleId = cycle.id;

  const category = await prisma.evidenceCategory.create({
    data: {
      code: `rpt-cat-${randomUUID()}`,
      labelTh: 'เอกสาร',
      allowedMimeTypes: ['application/pdf'],
    },
  });
  const ev = await app.inject({
    method: 'POST',
    url: '/api/v1/evidence',
    headers: { authorization: `Bearer ${teacherToken}`, 'x-school-id': school.id },
    payload: {
      category_id: category.id,
      title: 'แผนการจัดการเรียนรู้ Active Learning ชั้น ม.2',
      description: 'บันทึกการสอนและการประเมินผลผู้เรียน',
    },
  });
  assert.equal(ev.statusCode, 201, ev.body);
  evidenceId = ev.json().id;
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

test('suggestMappings creates ai_suggested rows without auto-confirm', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/evidence/${evidenceId}/mappings/suggest`,
    headers: { authorization: `Bearer ${teacherToken}`, 'x-school-id': school.id },
    payload: { framework_version_id: frameworkId, max_suggestions: 3 },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.provider, 'local_heuristic');
  assert.ok(body.items.length >= 1, 'expected at least one suggestion');
  for (const m of body.items) {
    assert.equal(m.mapping_source, 'ai_suggested');
    assert.equal(m.status, 'suggested');
  }

  // teacher cannot confirm (own-revoke only)
  const confirm = await app.inject({
    method: 'PATCH',
    url: `/api/v1/mappings/${body.items[0].id}`,
    headers: { authorization: `Bearer ${teacherToken}`, 'x-school-id': school.id },
    payload: { action: 'confirm' },
  });
  assert.equal(confirm.statusCode, 403);

  const directorConfirm = await app.inject({
    method: 'PATCH',
    url: `/api/v1/mappings/${body.items[0].id}`,
    headers: { authorization: `Bearer ${directorToken}`, 'x-school-id': school.id },
    payload: { action: 'confirm' },
  });
  assert.equal(directorConfirm.statusCode, 200, directorConfirm.body);
  assert.equal(directorConfirm.json().status, 'confirmed');
});

test('createReport enqueues worker; runOnce fills payload and section refs', async () => {
  // Ensure mapping has cycle for report section eligibility
  await prisma.evidenceIndicatorMapping.updateMany({
    where: { evidenceId, status: 'confirmed' },
    data: { cycleId },
  });

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: { authorization: `Bearer ${directorToken}`, 'x-school-id': school.id },
    payload: {
      cycle_id: cycleId,
      subject_personnel_id: teacherPersonnelId,
      template_code: 'PA2_s',
    },
  });
  assert.equal(create.statusCode, 201, create.body);
  const report = create.json();
  assert.equal(report.status, 'draft');
  assert.equal(report.template_code, 'PA2_s');

  const job = await prisma.workerJob.findFirst({
    // MySQL provider takes a JSONPath string here, not the Postgres array form (ADR-0008)
    where: { jobType: 'report.generate', payload: { path: '$.report_id', equals: report.id } },
  });
  // Prisma JSON path filter may vary — fall back to scan
  const jobs = await prisma.workerJob.findMany({
    where: { jobType: 'report.generate', status: 'pending' },
  });
  const match = jobs.find((j) => j.payload?.report_id === report.id);
  assert.ok(match, 'report.generate job should be enqueued');

  // Process without S3 GC scheduling noise.
  //
  // Loop until THIS job is claimed, rather than calling runOnce once. runOnce
  // takes a single job off a queue that every other test file shares — node:test
  // runs files in parallel processes, so a sibling's file.process job can be the
  // one it picks, leaving this report at 'draft' and failing on a race that has
  // nothing to do with reports. Flaked ~2 runs in 3 once the CCR-014/CCR-015
  // suites were added and the queue got busier.
  for (let i = 0; i < 25; i++) {
    const stillPending = await prisma.workerJob.findUnique({ where: { id: match.id }, select: { status: true } });
    if (stillPending?.status === 'succeeded') break;
    await runOnce(env, fakeS3, { scheduleGc: false });
  }

  const get = await app.inject({
    method: 'GET',
    url: `/api/v1/reports/${report.id}`,
    headers: { authorization: `Bearer ${directorToken}`, 'x-school-id': school.id },
  });
  assert.equal(get.statusCode, 200, get.body);
  const detail = get.json();
  assert.equal(detail.status, 'pending_approval');
  assert.equal(detail.payload.generation_status, 'ready');
  assert.equal(detail.payload.template_code, 'PA2_s');
  assert.ok(Array.isArray(detail.section_refs));
  assert.ok(detail.section_refs.length >= 1, 'confirmed mapping should become section ref');

  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/reports',
    headers: { authorization: `Bearer ${teacherToken}`, 'x-school-id': school.id },
  });
  assert.equal(list.statusCode, 200);
  assert.ok(list.json().items.some((r) => r.id === report.id));
});

test('teacher cannot createReport', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: { authorization: `Bearer ${teacherToken}`, 'x-school-id': school.id },
    payload: {
      cycle_id: cycleId,
      subject_personnel_id: teacherPersonnelId,
      template_code: 'PA3_s',
    },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'PERM-001');
});
