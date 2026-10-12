#!/usr/bin/env bash
# CI: start SeaweedFS's S3 gateway (ADR-0013) on :8333 with the dev identity in
# infra/seaweedfs/s3.dev.json, wait for it, and create $S3_BUCKET. A `services:`
# container cannot mount a checked-out file or run an init step, hence a script.
set -euo pipefail
# Small volumes, fixed count: each bucket is a collection with its own volumes,
# and -volume.max=0 ran out after a few buckets on a CI disk (500 on PutObjectPart).
docker run -d --name seaweedfs -p 8333:8333 \
  -v "$PWD/infra/seaweedfs/s3.dev.json:/etc/seaweedfs/s3.json:ro" \
  chrislusf/seaweedfs:4.48 \
  server -dir=/data -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json \
  -master.volumeSizeLimitMB=64 -volume.max=100
for _ in $(seq 1 60); do
  if curl -s -o /dev/null http://127.0.0.1:8333/; then
    if docker exec seaweedfs sh -c "echo 's3.bucket.create -name ${S3_BUCKET:-seip-evidence}' | weed shell -master=localhost:9333" 2>&1 | grep -q 'created bucket\|already exist'; then
      echo "seaweedfs ready, bucket ${S3_BUCKET:-seip-evidence}"; exit 0
    fi
  fi
  sleep 2
done
echo "::error::seaweedfs did not become ready"; docker logs seaweedfs | tail -50; exit 1
