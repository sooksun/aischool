# UI Field → Contract Trace — SEIP-UI-000 (AC3)

ทุก field ที่ UI ใช้ ต้องชี้ได้ว่ามาจาก/ส่งไปที่ field ไหนใน `docs/contracts/openapi.yaml` v0.1
ผล: **ครบ 34/37 — gap 3 รายการ → CCR-002** (แก้ contract แล้ว ดูท้ายไฟล์)

## S1 หลักฐานของฉัน (read)

| UI element | Contract source |
|---|---|
| การ์ด: ชื่อหลักฐาน | `Evidence.title` ← `listEvidence` |
| การ์ด: หมวด (ไอคอน+ป้าย) | `Evidence.category_id` → lookup `EvidenceCategory.{code,label_th}` |
| การ์ด: สถานะสแกน | `EvidenceDetail.files[].scan_status` (list ใช้ badge จาก detail fetch หรือ denormalized ใน Sprint 1 ตาม perf) |
| การ์ด: ตัวชี้วัดที่ผูก (chips) | `EvidenceDetail.mappings[].indicator_id` → lookup `Indicator.code` |
| การ์ด: วันที่ | `Evidence.created_at` |
| Paging | `EvidencePage.meta.{page,page_size,total}` |
| Filter สถานะ | query `status` ← `EvidenceStatus` enum |

## S3 รายละเอียด (write เตรียม + validation)

| UI element | Contract source |
|---|---|
| การ์ดหมวด 5 ใบ | `listEvidenceCategories` → `EvidenceCategory.{id,code,label_th}` |
| Validation ก่อนอัปโหลด: ชนิดไฟล์ | `EvidenceCategory.allowed_mime_types` |
| Validation: ขนาด | `EvidenceCategory.max_byte_size` |
| Validation: ความยาววิดีโอ | `EvidenceCategory.max_duration_seconds` |
| ชื่อหลักฐาน (auto-fill) | → `EvidenceCreate.title` (min 1 / max 300 ตาม schema) |
| คำอธิบาย (accordion "เพิ่มเติม") | → `EvidenceCreate.description` (max 2000) |
| วันที่จัดกิจกรรม (accordion) | → `EvidenceCreate.captured_at` |
| เจ้าของ (ซ่อน — default ตนเอง) | → `EvidenceCreate.owner_personnel_id` (null = self ตาม schema description) |

## S4 ผูกตัวชี้วัด

| UI element | Contract source |
|---|---|
| หา framework ของฉัน | `listFrameworks?role_family=…&status=active` — role_family มาจาก **`CurrentUser.personnel.position_role`** ⚠ *GAP-1 (แก้แล้ว)* |
| ด้าน → chips ตัวชี้วัด | `getFramework` → `FrameworkDetail.domains[].indicators[].{id,code,name_th}` (กรอง `indicator_kind=standard`, `is_scored=true`) |
| ข้อความระดับที่คาดหวังของฉัน (help text) | `getFramework?include=levels` → `IndicatorLevel.expected_practice_th` กรองด้วย **`CurrentUser.personnel.rank_level_code`** ⚠ *GAP-1 (แก้แล้ว)* |
| ส่ง mapping | → `MappingCreate.{indicator_id, cycle_id?, rationale?}` ผ่าน `createMapping` |
| chip disabled (ผูกแล้ว) | `EvidenceDetail.mappings[].{indicator_id,status}` — กัน MAP-001 ล่วงหน้า |

## S5–S7 อัปโหลด

| UI element | Contract source |
|---|---|
| สร้าง evidence | `createEvidence` → `Evidence.id`; สถานะเริ่ม **draft → active เมื่อ complete สำเร็จ** ⚠ *GAP-2 (แก้แล้ว)* |
| ขอ upload target | → `FileUploadInitiate.{content_type, byte_size, checksum_sha256, original_filename, duration_seconds}` |
| PUT ไฟล์ | `FileUploadTarget.{upload_url, method, headers, expires_at}` + progress จาก XHR |
| duration วิดีโออ่านไม่ได้ | ส่ง `duration_seconds: null` ได้ — server probe ตัดสิน ⚠ *GAP-3 (แก้แล้ว)* |
| ยืนยันเสร็จ | → `FileUploadComplete.checksum_sha256` → `EvidenceFile` |
| สถานะสแกน + ลิงก์ดูไฟล์ | `EvidenceFile.{scan_status, download_url}` (null จน clean) |
| Error ทุกจุด | `Error.{code,message,details[],request_id}` map เป็นข้อความไทยตาม error-codes.yaml |

## Auth (ทุกหน้า)

| UI element | Contract source |
|---|---|
| Login form | `LoginRequest.{email,password}` → `TokenPair` |
| ชื่อผู้ใช้บน header | `CurrentUser.display_name` |
| บริบทโรงเรียน/บทบาท | `CurrentUser.memberships[].{role, school_id}` |
| ตัวตน personnel (evaluatee) | `CurrentUser.personnel.{id, position_role, rank_level_code}` ⚠ *GAP-1 (แก้แล้ว)* |

## Gaps → CCR-002 (สรุป)

| Gap | ปัญหา | การแก้ (contract ยัง draft — แก้ตรงได้ พร้อมบันทึก) |
|---|---|---|
| GAP-1 | `CurrentUser` มีแค่ `personnel_id` — UI ไม่รู้ role_family/วิทยฐานะ จึงเลือก framework และแสดง expected-level text ไม่ได้ | เปลี่ยน `personnel_id` → object `personnel {id, position_role, rank_level_code}` (nullable) |
| GAP-2 | `createEvidence` ไม่ระบุสถานะเริ่มต้น — UI ไม่รู้ว่า "ร่าง" กับ "ส่งแล้ว" ต่างกันตรงไหน | ระบุใน contract: create → `status=draft`; complete upload สำเร็จ → server เปลี่ยนเป็น `active`; ผู้ใช้แก้ metadata ได้ระหว่าง draft |
| GAP-3 | `FileUploadInitiate.duration_seconds` เดิมสื่อว่า "required สำหรับวิดีโอ" — มือถือบางเครื่องอ่าน metadata ไม่ได้ จะส่งไม่ได้เลย | ผ่อนเป็น: ส่งเมื่ออ่านได้ (แนะนำ); null ได้ — server probe หลังอัปโหลดเป็นผู้ตัดสิน UPL-003 เสมอ |

รายละเอียดเต็มใน [`../../reviews/CCR-002-ui-000-contract-gaps.md`](../../reviews/CCR-002-ui-000-contract-gaps.md)
