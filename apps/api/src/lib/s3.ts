// Object storage client — the official AWS S3 SDK, pointed at MinIO's S3-compatible
// endpoint (ADR-0005: consumed through the S3 API only, so migrating to real S3/R2
// later is a config change, not a rewrite). forcePathStyle is required for MinIO
// (it doesn't do virtual-hosted-style bucket addressing by default).
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
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
export function createS3Client(env: Env): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }, // gitleaks:allow
  });
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

export async function presignUpload(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
): Promise<PresignedUpload> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
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
