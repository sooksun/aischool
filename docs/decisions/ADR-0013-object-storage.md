# ADR-0013: Object storage — ใช้ S3 API เท่านั้น พร้อม versioning, Object Lock และ legal hold

## Status
**Accepted** (2026-10-12, owner อนุมัติ; เสนอ 2026-10-12) — ดำเนินการใน P0. Supersedes ADR-0005 §1 (เลือก MinIO) แต่**คงกติกา** "ใช้ S3 API เท่านั้น" และ "ไบต์ของไฟล์ไม่ผ่าน API process"

## Context
- **MinIO หยุดเผยแพร่ Docker image และ binary รุ่น community ตั้งแต่ ต.ค. 2025** และ repo ถูก archive ในปี 2026 ([Chainguard](https://www.chainguard.dev/unchained/secure-and-free-minio-chainguard-containers), [madewithlove](https://madewithlove.com/blog/thanks-for-all-the-buckets/))
- `minio/minio:RELEASE.2025-04-22T22-12-26Z` ที่อ้างใน `ci.yml` (3 jobs), `docker-compose.yml` และ `docker-compose.staging.yml` บนทั้ง develop และ L2 **ดึงไม่ได้แล้ว** ทำให้ CI แดง 3 gates (PR #3) และการติดตั้งใหม่ทุกที่พังตั้งแต่ `docker compose up`
- หลักฐานคือสิ่งที่ทำซ้ำไม่ได้ (ครูอัดคาบสอนเทอมที่แล้วใหม่ไม่ได้) และไฟล์ที่ส่ง DPA แล้วต้องพิสูจน์ได้ว่าไม่ถูกแก้

## Decision
1. **Production**: Amazon S3 Bangkok, SSE-KMS, versioning
   - ไฟล์ต้นฉบับ: **Object Lock โหมด governance 30 วัน**
   - ไฟล์ที่อยู่ใน DPA Pack ที่ส่งออกแล้ว: **legal hold** จนถึงผลประเมินบวกระยะอุทธรณ์
   - bucket backup: Object Lock โหมด compliance 35 วัน
2. **Dev, CI และ Thai-owned profile**: **SeaweedFS 4.48** (Garage เป็นตัวสำรอง)
3. **ลบ MinIO ออก** จาก CI และ compose ทั้งหมดใน P0
4. P0 CI รัน **conformance suite** สำหรับ presigned multipart, checksum และ Object Lock กับ storage ทุกตัวที่รองรับ

## Conformance results (P0, 2026-10-12)
`tests/storage/s3-conformance.test.mjs` (`npm run test:storage`, run in the CI integration gate) against SeaweedFS 4.48:
- presigned single PUT binds Content-Length ✔
- presigned multipart UploadPart with `x-amz-checksum-sha256` as a signed header ✔, and a corrupted part is rejected (400) ✔
- ListParts resume ✔, server-side complete from ListParts ✔, abort ✔
- Object Lock governance retention and legal hold both refuse deletion ✔
- **Constraint found:** do **not** set `ChecksumAlgorithm` on CreateMultipartUpload. SeaweedFS's ListParts does not return part checksums, so a full-object-checksum complete fails `InvalidRequest`. Parts are still verified one by one. Whole-object integrity comes from the worker's SHA-256 re-hash (ADR-0018).
- **To verify in P1:** run the same suite against Amazon S3 ap-southeast-7.
- **Dev/CI sizing:** `-master.volumeSizeLimitMB=64 -volume.max=100`. Every bucket is a SeaweedFS collection with its own volumes, and with `-volume.max=0` a small disk ran out after a few buckets (500 on PutObjectPart). Staging keeps 1024 MB / auto.

## Options Considered
1. **S3 Bangkok + SeaweedFS (เลือก)** — managed ใน production และใช้ open source ที่ยังดูแลอยู่สำหรับ dev/Thai-owned
2. MinIO rebuild ของ Chainguard — ใช้ได้ระยะสั้น แต่ขึ้นกับผู้ rebuild รายเดียวและต้องพิจารณาผลของ AGPLv3
3. Ceph RGW — หนักเกินไปสำหรับทีมคนเดียว

## Consequences
- แอปใช้แค่ S3 API อยู่แล้ว (ADR-0005 §3) การเปลี่ยนจึงเป็นเรื่อง configuration และ CI ไม่ต้องแก้โค้ดแอป
- Object Lock ทำให้ "ลบหลักฐาน" ใน v1 เป็น soft-delete ระหว่างช่วง retention

## Approved By
owner (sooksun) — 2026-10-12

## Date
2026-10-12
