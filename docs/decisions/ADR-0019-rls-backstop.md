# ADR-0019: RLS backstop ตาม สพท. — role อ่านอย่างเดียว `seip_scoped` และ `withAreaScope`

## Status
**Accepted** (2026-10-13, owner อนุมัติ; เสนอ 2026-10-12) — ลงรายละเอียดข้อ 3 ของ ADR-0012 ("RLS backstop แยกตาม สพท.") ใน SEIP-P1-002

## Context
- ADR-0012 กำหนดให้ RLS เป็นกำแพงชั้นที่สองหลัง authorization ใน apps/api. Exit criterion ของ P1 คือ "RLS ปฏิเสธการอ่านข้าม สพท. ใน raw SQL"
- ทุก query ของแอปวิ่งผ่าน Prisma ที่ใช้ pool ร่วมกัน (role `seip_app`). ถ้าจะใส่ context ของผู้ใช้ให้ทุก query ต้องผูก context กับ connection ทุกครั้งที่ยืม ซึ่งชนกับการ batch `findUnique` ของ Prisma (query จากหลาย request อาจรวมกันใน tick เดียว) เสี่ยงทั้งปฏิเสธผิดและรั่วผิด context
- worker, seed, สคริปต์ ops และ test fixture ต้องอ่านเขียนข้าม สพท. ได้
- บน RDS ผู้ดูแลไม่ใช่ superuser จึงสร้าง role ที่มี `BYPASSRLS` ไม่ได้
- raw SQL ที่อ่านข้อมูล tenant จะเริ่มมีใน P3 (vector search) ตอนนี้มีเพียง outbox ซึ่งไม่ใช่ข้อมูล tenant

## Decision
1. **Role `seip_scoped`** (NOLOGIN, อ่านอย่างเดียว, ไม่มี BYPASSRLS) สร้างใน `bootstrap-roles.sql`. `seip_app` เป็นสมาชิกแบบ `SET TRUE, INHERIT FALSE` คือสลับเข้าไปได้ แต่ไม่ได้รับสิทธิ์ของมันโดยอัตโนมัติ
2. **Policy บน 5 ตาราง**: `evidence`, `evidence_file`, `evidence_indicator_mapping`, `upload_session`, `personnel_profile`. Policy มีผลเฉพาะเมื่อ `current_user = 'seip_scoped'` ส่วน `seip_app` และ `seip_migrator` เห็นเหมือนเดิม
3. **Scope** เป็นค่า transaction-local สามตัว ได้แก่ `seip.area_ids`, `seip.school_ids` และ `seip.person_ids`
   - evidence มองเห็นเมื่อผู้เป็นเจ้าของอยู่ใน scope, หรือ `controller_area_id` อยู่ใน scope, หรือโรงเรียนยังไม่มี สพท. และ `origin_school_id` อยู่ใน scope
   - ตารางลูกของ evidence มองเห็นตาม evidence แม่
   - personnel_profile มองเห็นเมื่อบุคคลอยู่ใน scope หรือโรงเรียนหรือ สพท. ของโปรไฟล์อยู่ใน scope
   - ค่าว่างหรือไม่ได้ตั้งหมายถึงไม่เห็นอะไรเลย (fail closed). ค่าผิดรูปจะเกิด error ไม่ใช่เห็นกว้างขึ้น
4. **`withAreaScope(scope, tx => …)`** ใน `packages/database` เปิด transaction แล้ว `SET LOCAL ROLE seip_scoped` และตั้ง scope ก่อนเรียก `fn`. **`resolveAreaScope`** คำนวณ scope จาก membership ที่ active ได้แก่ โรงเรียน, สพท. ของโรงเรียนเหล่านั้น และ สพท. ที่เป็น area_admin. บุคคลใน scope คือตัวเองและผู้รับการประเมินที่ตนนั่งเป็นกรรมการ ตรงกับสิ่งที่ API อนุญาต
5. **กติกา**: raw SQL ทุกตัวที่อ่านข้อมูล tenant ต้องรันใน `withAreaScope`. ORM read ที่ filter ผิดแล้วจะรั่วก็ควรใช้เช่นกัน. เริ่มจาก `listEvidence`
6. ผู้ใช้ที่ไม่ผ่าน scope (worker, seed, ops, migration) ยังใช้ `seip_app` และ `seip_migrator` ตามเดิม

## Options Considered
1. **Role แยก + เปิดใช้เฉพาะช่วงที่กำหนด (เลือก)** — แน่นอน ไม่ขึ้นกับ batching ของ Prisma ไม่ต้องใช้ BYPASSRLS และทดสอบได้ใน raw SQL. ข้อเสียคือ query ที่ไม่ได้ห่อด้วย `withAreaScope` ไม่ได้รับการป้องกัน
2. ผูก context เข้า connection ทุกครั้งที่ยืมผ่าน AsyncLocalStorage — ครอบคลุมทุก query แต่การ batch `findUnique` ของ Prisma ข้าม request ได้ ทำให้ context ผิดตัว
3. Prisma extension ห่อทุก query ด้วย batch transaction + `set_config` — ครอบคลุม แต่เพิ่ม BEGIN/COMMIT/SET อย่างน้อย 3 round trip ต่อ query และซ้อนกับ interactive transaction ที่มีอยู่ไม่ได้
4. Role `seip_system` ที่มี BYPASSRLS สำหรับ worker — สร้างบน RDS ไม่ได้

## Consequences
- กำแพงชั้นที่สองมีผลกับ query ที่ห่อแล้วเท่านั้น. `listEvidence` ห่อแล้ว ส่วน path อื่นยังพึ่ง authorization ใน API อย่างเดียว ซึ่งถูกทดสอบโดย permission sweep
- `listEvidence` มี transaction เพิ่ม 1 ครั้งและ query เล็กอีก 2 ครั้งต่อ request
- migration ใหม่ที่สร้างตาราง tenant ต้องพิจารณาว่าจะใส่ policy หรือไม่. `seip_scoped` ได้สิทธิ์ SELECT ตารางใหม่อัตโนมัติผ่าน default privileges
- Test: `tests/backend/rls-backstop.test.mjs` (raw SQL) และ `packages/database/test/area-scope.integration.test.mjs` (ผ่าน Prisma)

## Approved By
owner (sooksun) — 2026-10-13

## Date
2026-10-12
