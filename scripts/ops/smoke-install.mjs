#!/usr/bin/env node
/**
 * smoke-install — prove a fresh install works end to end, through the same
 * origin a browser uses. Run it after bring-up (ops-runbook §3); the CI
 * "deploy smoke" gate runs it against a freshly built staging stack.
 *
 *   SEIP_ADMIN_EMAIL=… SEIP_ADMIN_PASSWORD=… \
 *   node scripts/ops/smoke-install.mjs --base=http://127.0.0.1:8080
 *
 * As the bootstrap school_admin it invites a teacher; the teacher accepts the
 * invite, signs in, creates an evidence item and uploads a PDF via the
 * presigned URL; the worker scans it; the teacher downloads it back and the
 * bytes must match. Every URL the API hands out must be on --base: an upload
 * URL naming an internal host (http://seaweedfs:8333) is exactly the failure
 * this exists to catch.
 *
 * It leaves the smoke teacher and one evidence item behind in that school —
 * run it against a staging/acceptance install, or end the membership after.
 * Needs only Node ≥ 20 (global fetch); no workspace imports.
 */
import { createHash, randomUUID } from 'node:crypto';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const base = new URL(arg('base', 'http://127.0.0.1:8080')).origin;
const scanWaitMs = Number(arg('scan-wait-ms', '240000'));
const adminEmail = process.env.SEIP_ADMIN_EMAIL;
const adminPassword = process.env.SEIP_ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) {
  console.error('smoke-install: set SEIP_ADMIN_EMAIL and SEIP_ADMIN_PASSWORD (the bootstrap admin)');
  process.exit(2);
}

const step = (s) => console.log(`• ${s}`);
function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, json, text };
}

function expectStatus(r, want, what) {
  if (!(Array.isArray(want) ? want : [want]).includes(r.status)) fail(`${what}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r.json;
}

function onBase(url, what) {
  const origin = new URL(url).origin;
  if (origin !== base) fail(`${what} points at ${origin}, not ${base} — set S3_PUBLIC_ENDPOINT to the public origin`);
}

async function login(email, password) {
  return expectStatus(await api('POST', '/auth/login', { body: { email, password } }), 200, `login ${email}`).access_token;
}

// 1. The SPA is served.
const spa = await fetch(`${base}/`);
if (!spa.ok || !(await spa.text()).includes('<div id="root"')) fail(`GET / did not return the SPA (HTTP ${spa.status})`);
step('web serves the SPA');

// 2. The bootstrap admin signs in.
const adminToken = await login(adminEmail, adminPassword);
const me = expectStatus(await api('GET', '/auth/me', { token: adminToken }), 200, 'GET /auth/me');
step(`admin signed in (${me.memberships?.length ?? 0} membership(s))`);

// 3. Taxonomy is seeded (otherwise nothing can be mapped or categorised).
const frameworks = expectStatus(await api('GET', '/frameworks', { token: adminToken }), 200, 'GET /frameworks');
if (!Array.isArray(frameworks) || frameworks.length === 0) fail('no frameworks — run the seed (ops-runbook §3, step 6)');
const categories = expectStatus(await api('GET', '/evidence-categories', { token: adminToken }), 200, 'GET /evidence-categories');
const pdfCategory = (Array.isArray(categories) ? categories : []).find((c) => (c.allowed_mime_types ?? []).includes('application/pdf'));
if (!pdfCategory) fail('no evidence category accepts application/pdf — run the seed');
step(`taxonomy present (${frameworks.length} framework(s), ${categories.length} categories)`);

// 4. Invite → accept → sign in, exactly as a new teacher would.
const teacherEmail = `smoke-${randomUUID().slice(0, 8)}@smoke.invalid`;
const teacherPassword = randomUUID();
const invite = expectStatus(await api('POST', '/members', {
  token: adminToken,
  headers: { 'idempotency-key': randomUUID() },
  body: {
    email: teacherEmail, display_name: 'Smoke Teacher', role: 'teacher',
    personnel: { full_name: 'Smoke Teacher', position_role: 'teacher', rank_level_code: 'apply_adapt' },
  },
}), 201, 'invite a teacher');
if (!invite.invite_token) fail('invite returned no token');
expectStatus(await api('POST', '/auth/accept-invite', { body: { invite_token: invite.invite_token, password: teacherPassword } }), [200, 204], 'accept invite');
const teacherToken = await login(teacherEmail, teacherPassword);
step('a teacher was invited, accepted, and signed in');

// 5. Evidence + upload through the presigned URL.
const evidence = expectStatus(await api('POST', '/evidence', {
  token: teacherToken, headers: { 'idempotency-key': randomUUID() },
  body: { kind: 'file', contains_learners: 'no', client_uuid: randomUUID(), category_id: pdfCategory.id, title: 'smoke-install' },
}), 201, 'create evidence');
const bytes = Buffer.from(`%PDF-1.4\n% smoke-install ${new Date().toISOString()}\n%%EOF\n`);
const session = expectStatus(await api('POST', '/uploads', {
  token: teacherToken, headers: { 'idempotency-key': randomUUID() },
  body: {
    evidence_id: evidence.id, filename: 'smoke.pdf', content_type: 'application/pdf', byte_size: bytes.length,
    checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
  },
}), 201, 'open upload session');
if (!session.single_put?.url) fail('upload session has no single_put URL');
onBase(session.single_put.url, 'the upload URL');
const put = await fetch(session.single_put.url, { method: 'PUT', headers: session.single_put.headers, body: bytes });
if (!put.ok) fail(`PUT to the presigned URL: HTTP ${put.status} ${(await put.text()).slice(0, 300)}`);
const done = expectStatus(await api('POST', `/uploads/${session.id}/complete`, {
  token: teacherToken, body: { part_count: session.part_count },
}), 200, 'complete upload');
const fileId = done.id; // completeUpload returns the EvidenceFile
if (!fileId) fail(`complete returned no file id: ${JSON.stringify(done).slice(0, 300)}`);
step('uploaded through the public origin and completed');

// 6. The worker re-hashes and scans; then the bytes come back.
const deadline = Date.now() + scanWaitMs;
let download;
for (;;) {
  const r = await api('GET', `/evidence/${evidence.id}/files/${fileId}/download-url`, { token: teacherToken });
  if (r.status === 200) { download = r.json; break; }
  if (Date.now() > deadline) fail(`file never became downloadable (last: HTTP ${r.status} ${r.text.slice(0, 200)}) — is the worker running, and clamav healthy?`);
  await new Promise((s) => setTimeout(s, 3000));
}
onBase(download.download_url, 'the download URL');
const got = Buffer.from(await (await fetch(download.download_url)).arrayBuffer());
if (!got.equals(bytes)) fail('downloaded bytes differ from the uploaded ones');
step('the worker scanned it and the same bytes downloaded back');

console.log(`\n✓ ${base} is installed and working`);
