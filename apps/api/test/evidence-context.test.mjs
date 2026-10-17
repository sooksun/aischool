// FR-019 / CCR-024: an item a school admin uploads for a teacher waits for the
// teacher's acceptance before it can be mapped; the owner moves an item to
// another of their schools in the same สพท., and only there.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';
import { bearer, postEvidence, postMapping } from '../../../tests/helpers/api-evidence.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
let app, area, otherArea, schoolA, schoolB, schoolFar, teacher, admin, categoryId, indicatorId;

async function account(name, memberships, personnelAt = []) {
  const password = `ec-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: name } }, email: `ec-${name}-${randomUUID()}@x.io`, displayName: name, status: 'active', passwordHash: await argonHash(password) },
  });
  for (const [schoolId, role] of memberships) {
    await prisma.schoolMembership.create({ data: { userId: user.id, schoolId, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  }
  for (const schoolId of personnelAt) {
    await prisma.personnelProfile.create({ data: { schoolId, userId: user.id, personId: user.personId, fullName: name, positionRole: 'teacher', rankLevelCode: 'ec_kru' } });
  }
  const token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token;
  return { user, token };
}
const withSchool = (token, schoolId) => ({ ...bearer(token), 'x-school-id': schoolId });
const patch = (token, schoolId, id, version, body) => app.inject({
  method: 'PATCH', url: `/api/v1/evidence/${id}`, headers: { ...withSchool(token, schoolId), 'if-match': `"${version}"` }, payload: body,
});

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  area = await prisma.area.create({ data: { code: `ec-${randomUUID()}`, name: 'สพป.หนึ่ง' } });
  otherArea = await prisma.area.create({ data: { code: `ec-${randomUUID()}`, name: 'สพป.สอง' } });
  schoolA = created.add(await prisma.school.create({ data: { code: `ecA-${randomUUID()}`, name: 'A', areaId: area.id } }));
  schoolB = created.add(await prisma.school.create({ data: { code: `ecB-${randomUUID()}`, name: 'B', areaId: area.id } }));
  schoolFar = created.add(await prisma.school.create({ data: { code: `ecF-${randomUUID()}`, name: 'F', areaId: otherArea.id } }));
  await prisma.rankLevel.upsert({ where: { code: 'ec_kru' }, create: { code: 'ec_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {} });
  categoryId = (await prisma.evidenceCategory.create({ data: { code: `ec-cat-${randomUUID()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] } })).id;
  const fw = created.addFramework(await prisma.frameworkVersion.create({
    data: { code: `ec-fw-${randomUUID()}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
  }));
  const domain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: 'D', nameTh: 'd', sortOrder: 1, part: 'standards' } });
  indicatorId = (await prisma.indicator.create({ data: { domainId: domain.id, frameworkVersionId: fw.id, code: 'I', nameTh: 'i', sortOrder: 1, isScored: true, indicatorKind: 'standard' } })).id;

  teacher = await account('teacher', [[schoolA.id, 'teacher'], [schoolB.id, 'teacher'], [schoolFar.id, 'teacher']], [schoolA.id, schoolB.id, schoolFar.id]);
  admin = await account('admin', [[schoolA.id, 'school_admin']]);
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await prisma.area.deleteMany({ where: { id: { in: [area.id, otherArea.id] } } });
  await app.close();
  await prisma.$disconnect();
});

test('an item uploaded on the teacher\'s behalf counts only after the teacher accepts it', async () => {
  const made = await app.inject({
    method: 'POST', url: '/api/v1/evidence',
    headers: { ...bearer(admin.token), 'idempotency-key': randomUUID() },
    payload: { category_id: categoryId, title: 'แทนครู', kind: 'note', note_text: 'x', owner_person_id: teacher.user.personId, client_uuid: randomUUID() },
  });
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(made.json().owner_accepted_at, null);
  const id = made.json().id;

  const early = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${id}/mappings`, headers: { ...withSchool(teacher.token, schoolA.id), 'idempotency-key': randomUUID() },
    payload: { indicator_id: indicatorId },
  });
  assert.equal(early.json().code, 'VAL-002', early.body);

  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/evidence/${id}/accept`, headers: bearer(admin.token) })).json().code, 'RES-001', 'the uploader is not the owner');
  const ok = await app.inject({ method: 'POST', url: `/api/v1/evidence/${id}/accept`, headers: withSchool(teacher.token, schoolA.id) });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.ok(ok.json().owner_accepted_at);
  const again = await app.inject({ method: 'POST', url: `/api/v1/evidence/${id}/accept`, headers: withSchool(teacher.token, schoolA.id) });
  assert.equal(again.json().owner_accepted_at, ok.json().owner_accepted_at, 'idempotent');

  const mapped = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${id}/mappings`, headers: { ...withSchool(teacher.token, schoolA.id), 'idempotency-key': randomUUID() },
    payload: { indicator_id: indicatorId },
  });
  assert.equal(mapped.statusCode, 201, mapped.body);
});

test('the owner\'s own upload is accepted at once', async () => {
  const made = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: { ...withSchool(teacher.token, schoolA.id), 'idempotency-key': randomUUID() },
    payload: { category_id: categoryId, title: 'ของฉัน', kind: 'note', note_text: 'x', client_uuid: randomUUID() },
  });
  assert.ok(made.json().owner_accepted_at);
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: withSchool(teacher.token, schoolA.id) })).json();
  assert.equal(me.person_id, made.json().owner_person_id, '/auth/me names the person, so the client can tell its own items');
});

test('the owner moves an item to another of their schools in the same สพท.; not to another สพท., and not by the admin', async () => {
  const made = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: { ...withSchool(teacher.token, schoolA.id), 'idempotency-key': randomUUID() },
    payload: { category_id: categoryId, title: 'ผิดโรงเรียน', kind: 'note', note_text: 'x', client_uuid: randomUUID() },
  });
  const { id, version } = made.json();

  assert.equal((await patch(admin.token, schoolA.id, id, version, { origin_school_id: schoolB.id })).json().code, 'PERM-001');
  assert.equal((await patch(teacher.token, schoolA.id, id, version, { origin_school_id: schoolFar.id })).json().code, 'VAL-002');
  assert.equal((await patch(teacher.token, schoolA.id, id, version, { origin_school_id: randomUUID() })).json().code, 'VAL-002');

  const moved = await patch(teacher.token, schoolA.id, id, version, { origin_school_id: schoolB.id });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(moved.json().origin_school_id, schoolB.id);
  assert.ok(await prisma.auditEvent.findFirst({ where: { entityType: 'Evidence', entityId: id, action: 'moved' } }));
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/evidence/${id}`, headers: bearer(admin.token) })).json().code, 'RES-001', 'school A no longer sees it');
});
