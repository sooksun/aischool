// Outbox claim concurrency (2026-07-18 audit R1/R5) against real MySQL.
//
// claimUnpublishedOutbox documented an optimistic-CAS guarantee — "a losing
// racer's updateMany affects 0 rows and the row is skipped" — that the code did
// not implement. It gated on `publishedAt: null` while only incrementing
// `attempts`, so nothing the WHERE tested was changed by the claim: two
// concurrent dispatchers both matched, both got count === 1, and both claimed the
// same event. Single-worker deployment hid it; the comment made it look handled.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  enqueueOutboxEvent,
  claimUnpublishedOutbox,
  markOutboxFailed,
  markOutboxPublished,
} from '../dist/index.js';

const prisma = new PrismaClient();
const ids = [];

async function seedEvent(eventType = 'test.outbox.claim') {
  const id = randomUUID();
  await enqueueOutboxEvent({
    id,
    eventType,
    schoolId: null,
    actorUserId: null,
    payload: { probe: id },
  });
  ids.push(id);
  return id;
}

before(async () => {
  // Older unpublished rows from other suites would be picked up by any claim, so
  // every assertion below filters to ids this file created.
  await prisma.$connect();
});

after(async () => {
  await prisma.outboxEvent.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test('two concurrent dispatchers never claim the same event', async () => {
  const mine = new Set();
  for (let i = 0; i < 5; i += 1) mine.add(await seedEvent());

  const [a, b] = await Promise.all([
    claimUnpublishedOutbox(100),
    claimUnpublishedOutbox(100),
  ]);

  const aMine = a.filter((r) => mine.has(r.id)).map((r) => r.id);
  const bMine = b.filter((r) => mine.has(r.id)).map((r) => r.id);
  const overlap = aMine.filter((id) => bMine.includes(id));

  assert.deepEqual(overlap, [], `both dispatchers claimed: ${overlap.join(', ')}`);
  assert.equal(
    new Set([...aMine, ...bMine]).size, mine.size,
    'every event must still be claimed exactly once — the fix must not drop rows',
  );
});

test('claiming increments attempts exactly once', async () => {
  const id = await seedEvent();

  await claimUnpublishedOutbox(100);
  const afterClaim = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
  assert.equal(afterClaim.attempts, 1);

  // A second pass re-claims it (still unpublished) — the counter tracks tries.
  await claimUnpublishedOutbox(100);
  const afterSecond = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
  assert.equal(afterSecond.attempts, 2);
});

test('markOutboxFailed records the error without double-counting the attempt', async () => {
  const id = await seedEvent();

  await claimUnpublishedOutbox(100);
  await markOutboxFailed(id, 'consumer unreachable');

  const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
  assert.equal(row.lastError, 'consumer unreachable');
  assert.equal(
    row.attempts, 1,
    'claim counted the try; incrementing again here spent the attempts<10 budget twice per cycle',
  );
});

test('a published event is not re-claimed', async () => {
  const id = await seedEvent();

  await claimUnpublishedOutbox(100);
  await markOutboxPublished(id);

  const second = await claimUnpublishedOutbox(100);
  assert.ok(!second.some((r) => r.id === id), 'published rows must leave the queue');

  const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
  assert.equal(row.lastError, null, 'publishing clears the last error');
});
