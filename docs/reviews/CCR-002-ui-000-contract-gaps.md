# Contract Change Request: CCR-002

## Requested By
claude (SEIP-UI-000 — frontend-usability validation pass, per contract-policy step 3; single-agent mode ADR-0004)

## Contract Affected
`docs/contracts/openapi.yaml` v0.1.0-draft (unlocked)

## Reason
Field-trace ของ UX design (AC3) พบว่า contract ขาด/กำกวม 3 จุด ที่ทำให้ UI สร้างหน้าจอจริงไม่ได้:

1. **GAP-1 — ตัวตน personnel ไม่พอ**: `CurrentUser.personnel_id` เปล่า ๆ ไม่บอก `position_role` (เลือก framework ว9 หรือ ว10) และ `rank_level_code` (แสดงข้อความระดับที่คาดหวังตามวิทยฐานะ) — หน้าผูกตัวชี้วัด (S4) ต้องการทั้งคู่
2. **GAP-2 — สถานะเริ่มต้นของ evidence ไม่ระบุ**: UI ต้องแยก "ร่าง" (สร้างแล้ว ไฟล์ยังไม่ครบ) กับ "ส่งแล้ว" ให้ผู้ใช้เข้าใจ
3. **GAP-3 — `duration_seconds` เข้มเกินจริง**: มือถือบางเครื่องอ่าน video metadata ไม่ได้ ถ้า initiate บังคับค่า วิดีโอส่งไม่ได้เลย ทั้งที่ server ต้อง re-validate อยู่แล้ว

## Proposed Change (applied — contract is draft)
1. `CurrentUser`: แทน `personnel_id` ด้วย `personnel` object nullable: `{id, position_role, rank_level_code}`
2. `EvidenceCreate`/`Evidence.status`: ระบุ lifecycle — create → `draft`; complete upload แรกสำเร็จ → server เปลี่ยน `active`; `EvidencePatch.status` ใช้ archive/reject เท่านั้น (ไม่ใช่ draft→active เอง)
3. `FileUploadInitiate.duration_seconds`: คำอธิบายใหม่ — client ส่งเมื่ออ่านได้ (fail-fast UX), null ได้เสมอ; การบังคับ UPL-003 ตัดสินโดย server probe หลังอัปโหลด (ผล blocked → เหตุการณ์ scan_completed)

## Breaking Change
No — contract ยัง v0.1.0-draft, ไม่มี consumer จริง (types ยังไม่ถูก commit)

## Affected Modules
web (S4, S6, S7), api (evidence lifecycle + probe rule), worker (probe เป็นผู้ enforce UPL-003)

## Reviewers / Approval Status
**APPLIED 2026-07-17** — self-review under ADR-0004; final ratification at SEIP-ARCH-002 (user approves v1.0 lock)
