// S3_PUBLIC_ENDPOINT: in a container stack the API reaches the store at an
// internal name (http://seaweedfs:8333) that no browser can resolve, so presigned
// URLs must name the public origin instead — the web gateway forwards
// /<bucket>/… to the store with the Host header untouched, and the signature
// (which covers Host) still verifies. This stands in for that gateway with a
// tiny forwarding proxy and proves an upload through it lands and completes.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { hash as argonHash } from '@node-rs/argon2';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';
import { postEvidence, postUpload, completeUpload } from '../../../tests/helpers/api-evidence.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
const internal = new URL(process.env.S3_ENDPOINT ?? 'http://localhost:8333');
let app, gateway, publicOrigin, token, categoryId;
const forwarded = [];

before(async () => {
  // The "gateway": same path, same Host header, different origin.
  gateway = http.createServer((req, res) => {
    forwarded.push(`${req.method} ${req.url}`);
    const up = http.request(
      { host: internal.hostname, port: internal.port, method: req.method, path: req.url, headers: req.headers },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
    );
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
  });
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  publicOrigin = `http://127.0.0.1:${gateway.address().port}`;
  process.env.S3_PUBLIC_ENDPOINT = publicOrigin;

  const { buildServer } = await import('../dist/server.js');
  ({ app } = await buildServer());
  await app.ready();

  const school = created.add(await prisma.school.create({ data: { code: `pub-${randomUUID()}`, name: 'P' } }));
  const password = 'presign-public-pass-1234';
  const u = await prisma.userAccount.create({
    data: { person: { create: { displayName: 'p' } }, email: `pub-${randomUUID()}@x.io`, displayName: 'p', status: 'active', passwordHash: await argonHash(password) },
  });
  await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: school.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: u.email, password } })).json().access_token;
  const code = `pub-cat-${randomUUID()}`;
  categoryId = (await prisma.evidenceCategory.create({ data: { code, labelTh: 'x', allowedMimeTypes: ['application/pdf'] } })).id;
});

after(async () => {
  delete process.env.S3_PUBLIC_ENDPOINT;
  await cleanupSchools(prisma, created.ids(), created.userIds());
  await prisma.evidenceCategory.deleteMany({ where: { id: categoryId } }).catch(() => {});
  await app.close();
  await new Promise((r) => gateway.close(r));
  await prisma.$disconnect();
});

test('the presigned PUT names the public origin, works through the gateway, and the server completes it internally', async () => {
  const evidence = (await postEvidence(app, token, { category_id: categoryId, title: 'via gateway' })).json();
  const bytes = Buffer.from('%PDF-1.4 bytes through the public origin');
  const open = await postUpload(app, token, {
    evidence_id: evidence.id, filename: 'g.pdf', content_type: 'application/pdf', byte_size: bytes.length,
    checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  assert.equal(open.statusCode, 201, open.body);
  const session = open.json();
  const url = new URL(session.single_put.url);
  assert.equal(url.origin, publicOrigin, 'signed for the origin a browser can reach, not the internal one');

  const put = await fetch(session.single_put.url, { method: 'PUT', headers: session.single_put.headers, body: bytes });
  assert.ok(put.ok, `the store accepted the signature through the gateway (${put.status})`);
  assert.ok(forwarded.some((l) => l.startsWith('PUT ')), 'the bytes really went through the gateway');

  // Completion is a server-side HEAD against the internal endpoint.
  assert.equal((await completeUpload(app, token, session.id, session.part_count)).statusCode, 200);
});
