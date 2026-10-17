// FR-051 / US-13: a teacher moves from school A to school B in the same สพท.
// The portfolio goes with them; school A sees nothing new; a mapping confirmed
// after the move belongs to school B, whose director opens the evidence and
// validates it.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';
import { bearer, postEvidence, postMapping, actOnMapping } from '../../../tests/helpers/api-evidence.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
let app, area, schoolA, schoolB, teacher, teacherToken, directorA, directorB, categoryId, indicatorId, oldEvidenceId, newEvidenceId, usedAtAId;

async function account(name) {
  const password = `tr-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: name } }, email: `tr-${name.toLowerCase()}-${randomUUID()}@x.io`, displayName: name, status: 'active', passwordHash: await argonHash(password) },
  });
  return { user, login: async () => (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token };
}
const member = (userId, schoolId, role, extra = {}) => prisma.schoolMembership.create({
  data: { userId, schoolId, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active', ...extra },
});
const get = (token, url) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: bearer(token) });

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  area = await prisma.area.create({ data: { code: `tr-${randomUUID()}`, name: 'สพป.ย้าย' } });
  schoolA = created.add(await prisma.school.create({ data: { code: `trA-${randomUUID()}`, name: 'A', areaId: area.id } }));
  schoolB = created.add(await prisma.school.create({ data: { code: `trB-${randomUUID()}`, name: 'B', areaId: area.id } }));
  await prisma.rankLevel.upsert({ where: { code: 'tr_kru' }, create: { code: 'tr_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {} });
  categoryId = (await prisma.evidenceCategory.create({ data: { code: `tr-cat-${randomUUID()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] } })).id;
  const fw = created.addFramework(await prisma.frameworkVersion.create({
    data: { code: `tr-fw-${randomUUID()}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
  }));
  const domain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: 'D', nameTh: 'd', sortOrder: 1, part: 'standards' } });
  indicatorId = (await prisma.indicator.create({
    data: { domainId: domain.id, frameworkVersionId: fw.id, code: 'I-1', nameTh: 'i', sortOrder: 1, isScored: true, indicatorKind: 'standard' },
  })).id;

  teacher = await account('teacher');
  for (const s of [schoolA, schoolB]) {
    await prisma.personnelProfile.create({
      data: { schoolId: s.id, userId: teacher.user.id, personId: teacher.user.personId, fullName: 'ครูย้าย', positionRole: 'teacher', rankLevelCode: 'tr_kru' },
    });
  }
  const tA = await member(teacher.user.id, schoolA.id, 'teacher');
  teacherToken = await teacher.login();
  oldEvidenceId = (await postEvidence(app, teacherToken, { category_id: categoryId, title: 'ก่อนย้าย' })).json().id;
  assert.ok(oldEvidenceId);
  // Used in school A's evaluation before the move: A keeps this one (OQ-12).
  usedAtAId = (await postEvidence(app, teacherToken, { category_id: categoryId, title: 'ใช้ที่ A' })).json().id;
  assert.equal((await postMapping(app, teacherToken, usedAtAId, indicatorId)).statusCode, 201);

  // The move: school A ends the membership, school B adds one.
  await prisma.schoolMembership.update({ where: { id: tA.id }, data: { status: 'ended', effectiveTo: new Date(Date.now() - 86_400_000) } });
  await member(teacher.user.id, schoolB.id, 'teacher');

  const dA = await account('dirA');
  await member(dA.user.id, schoolA.id, 'director');
  directorA = await dA.login();
  const dB = await account('dirB');
  await member(dB.user.id, schoolB.id, 'director');
  directorB = await dB.login();
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await prisma.area.delete({ where: { id: area.id } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

test('after the move the teacher still has the whole portfolio', async () => {
  const list = await get(teacherToken, '/evidence');
  assert.equal(list.statusCode, 200, list.body);
  assert.ok(list.json().items.some((i) => i.id === oldEvidenceId));
  assert.equal((await get(teacherToken, `/evidence/${oldEvidenceId}`)).statusCode, 200);
});

test('school A cannot find or open evidence added at school B', async () => {
  const made = await postEvidence(app, teacherToken, { category_id: categoryId, title: 'หลังย้าย' });
  assert.equal(made.statusCode, 201, made.body);
  newEvidenceId = made.json().id;
  assert.equal(made.json().origin_school_id, schoolB.id);
  assert.equal((await get(directorA, `/evidence/${newEvidenceId}`)).json().code, 'RES-001');
  assert.ok(!(await get(directorA, '/evidence')).json().items.some((i) => i.id === newEvidenceId));
});

test('a mapping confirmed after the move belongs to school B: its director opens and validates it, A cannot', async () => {
  assert.equal((await get(directorB, `/evidence/${oldEvidenceId}`)).json().code, 'RES-001', 'nothing mapped to B yet');

  const m = await postMapping(app, teacherToken, oldEvidenceId, indicatorId);
  assert.equal(m.statusCode, 201, m.body);
  const queue = await get(directorB, '/mappings');
  assert.ok(queue.json().items.some((x) => x.id === m.json().id), 'in school B\'s review queue');
  assert.ok(!(await get(directorA, '/mappings')).json().items.some((x) => x.id === m.json().id), 'not in school A\'s');

  assert.equal((await get(directorB, `/evidence/${oldEvidenceId}`)).statusCode, 200, 'B opens the evidence behind its mapping');
  assert.equal((await get(directorB, `/evidence/${oldEvidenceId}/mappings`)).statusCode, 200);

  const byA = await actOnMapping(app, directorA, m.json().id, m.json().version, 'validate');
  assert.equal(byA.statusCode, 404, byA.body);
  const byB = await actOnMapping(app, directorB, m.json().id, m.json().version, 'validate');
  assert.equal(byB.statusCode, 200, byB.body);
  assert.equal(byB.json().status, 'validated');
});

test('OQ-12: after the move school A keeps only what its own evaluation used', async () => {
  assert.equal((await get(directorA, `/evidence/${usedAtAId}`)).statusCode, 200, 'mapped at A: kept');
  assert.equal((await get(directorA, `/evidence/${oldEvidenceId}`)).json().code, 'RES-001', 'never used at A: gone for A');
  const listed = (await get(directorA, '/evidence')).json().items.map((i) => i.id);
  assert.ok(listed.includes(usedAtAId));
  assert.ok(!listed.includes(oldEvidenceId));
  assert.equal((await get(teacherToken, `/evidence/${oldEvidenceId}`)).statusCode, 200, 'the owner still has it');
});
