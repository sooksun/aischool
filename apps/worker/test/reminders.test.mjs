// FR-100 / CCR-029: the DPO is reminded, once per milestone, about an open
// data-subject request that falls due within 7 days, within 1 day, or is overdue.
// remindDueSubjectRequests is called directly with a fixed clock (the job-queue
// path is the shared claim/markDone wiring loop.ts already covers).
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { remindDueSubjectRequests } from '@seip/database';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

const prisma = createPrismaClient();
const created = trackSchools();
const DAY = 86400000;
let area, otherArea, school, dpo, otherDpo, person;

async function account(key) {
  const u = await prisma.userAccount.create({
    data: { person: { create: { displayName: key } }, email: `rem-${key}-${randomUUID()}@x.io`, displayName: key, status: 'active' },
  });
  created.addUser(u);
  return u;
}

async function request(dueInDays, status = 'received') {
  const now = Date.now();
  return prisma.subjectRequest.create({
    data: {
      personId: person.personId, requestedByUserId: person.id, schoolId: school.id, areaId: area.id, requestType: 'correction',
      status, receivedAt: new Date(now - 30 * DAY + dueInDays * DAY), dueAt: new Date(now + dueInDays * DAY),
      ...(status === 'received' ? {} : { decidedAt: new Date(), decidedByUserId: dpo.id, ...(status === 'rejected' ? { decisionNote: 'x' } : {}) }),
    },
  });
}

const notesFor = (id) => prisma.notification.findMany({ where: { entityId: id, kind: 'deadline' }, orderBy: { createdAt: 'asc' } });

before(async () => {
  area = await prisma.area.create({ data: { code: `rem-a-${randomUUID()}`, name: 'A' } });
  otherArea = await prisma.area.create({ data: { code: `rem-b-${randomUUID()}`, name: 'B' } });
  school = created.add(await prisma.school.create({ data: { code: `rem-s-${randomUUID()}`, name: 'S', areaId: area.id } }));
  dpo = await account('dpo');
  otherDpo = await account('otherdpo');
  person = await account('teacher');
  await prisma.schoolMembership.create({ data: { userId: dpo.id, areaId: area.id, role: 'dpo', membershipScope: 'area', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  await prisma.schoolMembership.create({ data: { userId: otherDpo.id, areaId: otherArea.id, role: 'dpo', membershipScope: 'area', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  await prisma.schoolMembership.create({ data: { userId: person.id, schoolId: school.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
});

after(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [dpo.id, otherDpo.id] } } });
  await cleanupSchools(prisma, created.ids(), created.userIds());
  await prisma.area.deleteMany({ where: { id: { in: [area.id, otherArea.id] } } }).catch(() => {});
  await prisma.$disconnect();
});

test('one reminder per milestone, to the DPO of the area only; closed and far-off requests are quiet', async () => {
  const far = await request(20);
  const week = await request(5);
  const tomorrow = await request(0.5);
  const late = await request(-2);
  const closed = await request(3, 'rejected');

  await remindDueSubjectRequests();
  await remindDueSubjectRequests(); // the same hour again: nothing new

  assert.equal((await notesFor(far.id)).length, 0, 'not yet within 7 days');
  assert.equal((await notesFor(closed.id)).length, 0, 'a closed request is not chased');
  for (const r of [week, tomorrow, late]) {
    const n = await notesFor(r.id);
    assert.equal(n.length, 1, `exactly one reminder for ${r.id}`);
    assert.equal(n[0].userId, dpo.id, 'the DPO of this area, never another area\'s');
    assert.equal(n[0].route, '/dpo/requests');
    assert.ok(!n[0].titleTh.includes('teacher'), 'no name in the text');
  }
  assert.match((await notesFor(week.id))[0].titleTh, /อีก 5 วัน/);
  assert.match((await notesFor(late.id))[0].titleTh, /เกินกำหนด/);

  // Time passes: the 7-day request reaches its last day, then goes overdue — one new reminder each.
  await remindDueSubjectRequests(new Date(Date.now() + 4.6 * DAY));
  assert.equal((await notesFor(week.id)).length, 2);
  await remindDueSubjectRequests(new Date(Date.now() + 6 * DAY));
  await remindDueSubjectRequests(new Date(Date.now() + 7 * DAY));
  const all = await notesFor(week.id);
  assert.equal(all.length, 3);
  assert.match(all[2].titleTh, /เกินกำหนด/);
});
