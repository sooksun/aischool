/**
 * Contract 4.0.0 (CCR-017) evidence calls for API integration tests, driven
 * through Fastify's app.inject(). One place for the Idempotency-Key /
 * client_uuid / upload-session choreography, so a suite reads as the behaviour
 * it tests rather than the protocol.
 *
 * Bytes go to storage with a REAL fetch() to the presigned URL — that URL
 * points at the S3-API store, not at the Fastify app.
 */
import { randomUUID, createHash } from 'node:crypto';

export const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** POST /evidence (kind=file unless overridden). Returns the raw inject response. */
export function postEvidence(app, token, body, { idempotencyKey = randomUUID() } = {}) {
  return app.inject({
    method: 'POST', url: '/api/v1/evidence',
    headers: { ...bearer(token), 'idempotency-key': idempotencyKey },
    payload: { kind: 'file', contains_learners: 'unknown', client_uuid: randomUUID(), ...body },
  });
}

/** POST /uploads. Returns the raw inject response. */
export function postUpload(app, token, body, { idempotencyKey = randomUUID() } = {}) {
  return app.inject({
    method: 'POST', url: '/api/v1/uploads',
    headers: { ...bearer(token), 'idempotency-key': idempotencyKey },
    payload: body,
  });
}

export function completeUpload(app, token, uploadId, partCount = 1) {
  return app.inject({
    method: 'POST', url: `/api/v1/uploads/${uploadId}/complete`,
    headers: bearer(token), payload: { part_count: partCount },
  });
}

/**
 * Open a single_put session for `bytes`, PUT them, and complete. Returns
 * { session, file, complete } — `file` is the completeUpload body (EvidenceFile).
 * Throws with the API's answer if any step is refused, so a fixture failure
 * reads as the reason rather than an undefined property later.
 */
export async function uploadFile(app, token, evidenceId, bytes, {
  filename = 'file.pdf', contentType = 'application/pdf', durationMs, checksum,
} = {}) {
  const open = await postUpload(app, token, {
    evidence_id: evidenceId, filename, content_type: contentType, byte_size: bytes.length,
    checksum_sha256: checksum ?? createHash('sha256').update(bytes).digest('hex'),
    ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
  });
  if (open.statusCode !== 201) throw new Error(`createUpload ${open.statusCode}: ${open.body}`);
  const session = open.json();
  const put = await fetch(session.single_put.url, { method: 'PUT', headers: session.single_put.headers, body: bytes });
  if (!put.ok) throw new Error(`storage PUT ${put.status}: ${await put.text()}`);
  const complete = await completeUpload(app, token, session.id, session.part_count);
  if (complete.statusCode !== 200) throw new Error(`completeUpload ${complete.statusCode}: ${complete.body}`);
  return { session, file: complete.json(), complete };
}

export function postMapping(app, token, evidenceId, indicatorId, { idempotencyKey = randomUUID(), note } = {}) {
  return app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidenceId}/mappings`,
    headers: { ...bearer(token), 'idempotency-key': idempotencyKey },
    payload: { indicator_id: indicatorId, ...(note === undefined ? {} : { note }) },
  });
}

/** PATCH /mappings/:id with If-Match taken from `version` (pass null to omit it). */
export function actOnMapping(app, token, mappingId, version, action, returnNote) {
  return app.inject({
    method: 'PATCH', url: `/api/v1/mappings/${mappingId}`,
    headers: { ...bearer(token), ...(version === null ? {} : { 'if-match': `"${version}"` }) },
    payload: { action, ...(returnNote === undefined ? {} : { return_note: returnNote }) },
  });
}
