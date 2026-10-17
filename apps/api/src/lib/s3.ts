// Object storage client — the official AWS S3 SDK, pointed at an S3-compatible
// endpoint (ADR-0013: S3 API only — SeaweedFS in dev/CI, Amazon S3 Bangkok in
// production, a config change rather than a rewrite). forcePathStyle is required
// for SeaweedFS, which does not do virtual-hosted-style bucket addressing.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../env.js';

// gitleaks' generic-api-key rule flags the `secretAccessKey:` field name itself
// (identifier shape, not string entropy — confirmed by testing: it fires
// identically whether the RHS is a literal or, as here, a plain env-var
// reference). No literal secret is ever present; the real value lives only in
// `.env` (gitignored, SEC-REPO-1). Allowlisted by exact fingerprint in
// .gitleaks.toml with the reasoning recorded there — contorting this code to
// dodge a heuristic would cost more readability than the false positive costs.
export function createS3Client(env: Env, endpoint: string = env.S3_ENDPOINT): S3Client {
  return new S3Client({
    endpoint,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }, // gitleaks:allow
    // SDK v3 >= 3.729 defaults to WHEN_SUPPORTED, which bakes a CRC32 of the
    // EMPTY body (`x-amz-checksum-crc32=AAAAAA==`) into every presigned PUT. MinIO
    // ignored it; S3 and SeaweedFS verify it and answer 400 BadDigest for any real
    // upload. Integrity is the declared SHA-256, re-checked by the worker.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** The client that signs URLs a browser will follow. Signing makes no network
 * call, so it may name a host this process cannot reach; every server-side
 * request (head, list parts, complete, …) keeps using createS3Client. */
export function createPresignClient(env: Env): S3Client {
  return createS3Client(env, env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT);
}

/** Ensures the evidence bucket exists — safe to call on every boot (dev/CI
 * convenience). On-prem provisioning creates the bucket ahead of time instead;
 * this is a no-op there since the bucket already exists. */
export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export interface PresignedUpload {
  uploadUrl: string;
  expiresAt: Date;
}

const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * Object key layout: evidence/{schoolId}/{evidenceId}/{fileId}/{filename} — naturally
 * prefixes per school/evidence, useful for future lifecycle rules (retention per
 * entity-dictionary.md) without a separate index. Bytes never pass through this API
 * process (SEC-UPL-1) — the client PUTs directly to this URL.
 */
export function evidenceObjectKey(schoolId: string, evidenceId: string, fileId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(-200);
  return `evidence/${schoolId}/${evidenceId}/${fileId}/${safe}`;
}

/**
 * contentLength is signed, not decorative: it is listed in SignedHeaders, so the
 * storage service itself rejects a PUT whose actual Content-Length differs from
 * the byte_size the caller declared at initiate. Without it, UPL-002 checked a
 * number the server then never compared against anything real — declare 10
 * bytes, upload a gigabyte (2026-07-18 audit). The worker re-verifies the stored
 * object afterwards as defence in depth, since this layer only binds clients
 * that go through a presigned URL.
 */
export async function presignUpload(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
  contentLength: number,
): Promise<PresignedUpload> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    signableHeaders: new Set(['content-length', 'content-type']),
  });
  return { uploadUrl, expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000) };
}

export interface PresignedDownload {
  downloadUrl: string;
  expiresAt: Date;
}

const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * Short-lived GET for a stored object. Callers MUST gate on scan_status=clean
 * (UPL-006) before issuing — this helper does not enforce that rule.
 * storageUri/key never leaves the server except inside the signed query string.
 */
export async function presignDownload(
  client: S3Client,
  bucket: string,
  key: string,
  originalFilename?: string,
): Promise<PresignedDownload> {
  const safeName = originalFilename
    ? originalFilename.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180)
    : undefined;
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(safeName
      ? { ResponseContentDisposition: `attachment; filename="${safeName}"` }
      : {}),
  });
  const downloadUrl = await getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  return {
    downloadUrl,
    expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
  };
}

// ─────────────────── multipart (ADR-0016 §5, CCR-017) ───────────────────
// Rules from the conformance suite (tests/storage, ADR-0013):
//  - NO ChecksumAlgorithm on create: SeaweedFS's ListParts returns no part
//    checksums, so a full-object-checksum complete fails InvalidRequest.
//  - a part checksum, when the client supplies one, is a SIGNED header — the
//    store then verifies that part's bytes against it.
//  - the SERVER completes from its own ListParts; clients never read ETags.

export async function createMultipartUpload(client: S3Client, bucket: string, key: string, contentType: string): Promise<string> {
  const res = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
  if (!res.UploadId) throw new Error('store returned no UploadId');
  return res.UploadId;
}

export async function presignUploadPart(
  client: S3Client, bucket: string, key: string, uploadId: string, partNumber: number, checksumSha256?: string,
): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }> {
  const command = new UploadPartCommand({
    Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber,
    ...(checksumSha256 ? { ChecksumSHA256: checksumSha256 } : {}),
  });
  const url = await getSignedUrl(client, command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    ...(checksumSha256
      ? { signableHeaders: new Set(['x-amz-checksum-sha256']), unhoistableHeaders: new Set(['x-amz-checksum-sha256']) }
      : {}),
  });
  return {
    url,
    headers: checksumSha256 ? { 'x-amz-checksum-sha256': checksumSha256 } : {},
    expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
  };
}

/** Part numbers the store already holds, ascending (the resume point). */
export async function listUploadedParts(client: S3Client, bucket: string, key: string, uploadId: string) {
  const parts: { PartNumber: number; ETag: string; Size: number }[] = [];
  let marker: string | undefined;
  for (;;) {
    const res = await client.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
    for (const p of res.Parts ?? []) {
      if (p.PartNumber && p.ETag) parts.push({ PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size ?? 0 });
    }
    if (!res.IsTruncated) break;
    marker = res.NextPartNumberMarker;
  }
  return parts.sort((a, b) => a.PartNumber - b.PartNumber);
}

export async function completeMultipartFromListing(
  client: S3Client, bucket: string, key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[],
): Promise<void> {
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket, Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) },
  }));
}

export async function abortMultipartUpload(client: S3Client, bucket: string, key: string, uploadId: string): Promise<void> {
  await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
}

/** Size of a stored object, or null when it is not there. */
export async function storedObjectSize(client: S3Client, bucket: string, key: string): Promise<number | null> {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return res.ContentLength ?? 0;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (e as { name?: string }).name === 'NotFound') return null;
    throw e;
  }
}
