import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
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
