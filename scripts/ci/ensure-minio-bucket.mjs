#!/usr/bin/env node
// CI-only: docker-compose's minio-init service does the equivalent job for local
// dev, but a GitHub Actions `services:` container has no init-container concept —
// this script is the CI substitute. Requires apps/api already built (imports its
// dist/lib/s3.js — no separate copy of the S3 logic to maintain).
import { createS3Client, ensureBucket } from '../../apps/api/dist/lib/s3.js';

const client = createS3Client({
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
});
await ensureBucket(client, process.env.S3_BUCKET);
console.log(`bucket "${process.env.S3_BUCKET}" ready`);
