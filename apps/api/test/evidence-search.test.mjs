// FR-054: search and filter a portfolio — by title text, kind, work date, mapping
// state and evaluation cycle — on top of the existing category / status /
// indicator filters, without widening anyone's scope.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
let app, school, otherSchool, fw, categoryId, teacher, director, cycle, foreignCycle;
const token = {};
const ev = {};

async function account(key, role, sch) {
  const password = `srch-${key}-pass-1234`;
  const u = await prisma.userAccount.create({
    data: { person: { create: { displayName: key } }, email: `srch-${key}-${randomUUID()}@x.io`, displayName: key, status: 'active', passwordHash: await argonHash(password) },
  });
  await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: sch.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  await prisma.personnelProfile.create({ data: { schoolId: sch.id, userId: u.id, personId: u.personId, fullName: key, positionRole: 'teacher', rankLevelCode: 'srch_kru' } });
  token[key] = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: u.email, password } })).json().access_token;
  return u;
}

async function item(key, { title, kind = 'note', from = null, to = null, mapping = null }) {
  const e = await prisma.evidence.create({
    data: {
      ownerPersonId: teacher.personId, originSchoolId: school.id, uploadedByUserId: teacher.id, categoryId, title, kind,
      status: 'active', ownerAcceptedAt: new Date(), noteText: kind === 'note' ? 'x' : null, linkUrl: kind === 'link' ? 'https://example.org' : null,
      performedFrom: from ? new Date(from) : null, performedTo: to ? new Date(to) : null,
    },
  });
  if (mapping) {
    await prisma.evidenceIndicatorMapping.create({
      data: {
        schoolId: school.id, evidenceId: e.id, indicatorId: fw.indicators[0].id, frameworkVersionId: fw.id, mappingSource: 'manual', status: mapping,
        ownerConfirmedByUserId: teacher.id, ownerConfirmedAt: new Date(),
        ...(mapping === 'validated' ? { validatedByUserId: director.id, validatedAt: new Date(), validatorRole: 'director' } : {}),
        ...(mapping === 'returned' ? { validatedByUserId: director.id, validatedAt: new Date(), validatorRole: 'director', returnNote: 'เพิ่มภาพ' } : {}),
      },
    });
  }
  ev[key] = e.id;
}

const list = async (key, qs) => {
  const r = await app.inject({ method: 'GET', url: `/api/v1/evidence?page_size=100&${qs}`, headers: { authorization: `Bearer ${token[key]}` } });
  return r;
};
const ids = async (qs, key = 'teacher') => {
  const r = await list(key, qs);
  assert.equal(r.statusCode, 200, r.body);
  return new Set(r.json().items.map((i) => i.id));
};

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  school = created.add(await prisma.school.create({ data: { code: `srch-${randomUUID()}`, name: 'S' } }));
  otherSchool = created.add(await prisma.school.create({ data: { code: `srch-o-${randomUUID()}`, name: 'O' } }));
  await prisma.rankLevel.upsert({ where: { code: 'srch_kru' }, create: { code: 'srch_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {} });
  fw = await prisma.frameworkVersion.findFirstOrThrow({ where: { roleFamily: 'teacher', status: 'active' }, include: { indicators: { where: { isScored: true }, take: 1 } } });
  categoryId = (await prisma.evidenceCategory.findFirstOrThrow()).id;
  teacher = await account('teacher', 'teacher', school);
  director = await account('director', 'director', school);
  await account('stranger', 'teacher', otherSchool);

  await item('lesson', { title: 'แผนการสอน คณิตศาสตร์ ป.4', from: '2026-11-03', to: '2026-11-07', mapping: 'validated' });
  await item('pd', { title: 'อบรมพัฒนาวิชาชีพ', kind: 'link', from: '2027-02-10', mapping: 'owner_confirmed' });
  await item('returned', { title: 'ภาพกิจกรรมหน้าเสาธง', from: '2026-12-01', to: '2026-12-01', mapping: 'returned' });
  await item('nodate', { title: 'บันทึกไม่ระบุวัน' });
  cycle = await prisma.evaluationCycle.create({
    data: { schoolId: school.id, frameworkVersionId: fw.id, fiscalYear: 2570, evaluationKind: 'pa', title: 'c', startsOn: new Date('2026-10-01'), endsOn: new Date('2026-12-31') },
  });
  foreignCycle = await prisma.evaluationCycle.create({
    data: { schoolId: otherSchool.id, frameworkVersionId: fw.id, fiscalYear: 2570, evaluationKind: 'pa', title: 'f', startsOn: new Date('2026-10-01'), endsOn: new Date('2027-09-30') },
  });
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

test('title text, kind and mapping state', async () => {
  assert.deepEqual(await ids('q=%E0%B9%81%E0%B8%9C%E0%B8%99%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%AA%E0%B8%AD%E0%B8%99'), new Set([ev.lesson]), 'q=แผนการสอน');
  assert.deepEqual(await ids('kind=link'), new Set([ev.pd]));
  assert.deepEqual(await ids('mapping_state=unmapped'), new Set([ev.nodate]));
  assert.deepEqual(await ids('mapping_state=validated'), new Set([ev.lesson]));
  assert.deepEqual(await ids('mapping_state=returned'), new Set([ev.returned]));
  assert.deepEqual(await ids('mapping_state=owner_confirmed'), new Set([ev.pd]));
});

test('work-date window overlaps the item span; undated items drop out once a bound is set', async () => {
  assert.deepEqual(await ids('performed_from=2026-11-05&performed_to=2026-11-30'), new Set([ev.lesson]), 'overlap, not containment');
  assert.deepEqual(await ids('performed_from=2026-12-01'), new Set([ev.returned, ev.pd]));
  assert.deepEqual(await ids('performed_to=2026-11-03'), new Set([ev.lesson]));
  assert.deepEqual(await ids('performed_from=2027-03-01&performed_to=2027-01-01'), new Set(), 'an empty window is empty, not an error');
});

test('cycle: its dates bound the work date; a cycle of another school is VAL-002', async () => {
  assert.deepEqual(await ids(`cycle_id=${cycle.id}`), new Set([ev.lesson, ev.returned]));
  assert.deepEqual(await ids(`cycle_id=${cycle.id}&q=%E0%B8%A0%E0%B8%B2%E0%B8%9E`), new Set([ev.returned]), 'combines with the other filters');
  assert.deepEqual(await ids(`cycle_id=${cycle.id}`, 'director'), new Set([ev.lesson, ev.returned]), 'the director, school-wide');
  const foreign = await list('teacher', `cycle_id=${foreignCycle.id}`);
  assert.equal(foreign.json().code, 'VAL-002');
  assert.equal((await list('teacher', `cycle_id=${randomUUID()}`)).json().code, 'VAL-002');
});

test('filters never widen scope: a stranger finds nothing of this school', async () => {
  assert.equal((await ids('q=%E0%B9%81%E0%B8%9C%E0%B8%99', 'stranger')).size, 0);
  assert.equal((await list('teacher', 'kind=video')).statusCode, 400, 'unknown kind is a validation error');
});
