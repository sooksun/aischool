import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { Env } from './env.js';

export function createS3Client(env: Env): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY, // gitleaks:allow
    },
  });
}

export async function headObject(client: S3Client, bucket: string, key: string) {
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function deleteObject(client: S3Client, bucket: string, key: string) {
  return client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Object body as a stream, for piping to clamd (ADR-0009). A stream rather than
 * a buffer because evidence includes video: buffering a 25 MB file per concurrent
 * job would be a memory profile nobody chose. */
export async function getObjectStream(client: S3Client, bucket: string, key: string): Promise<Readable> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`object ${key} has no body`);
  return res.Body as Readable;
}
