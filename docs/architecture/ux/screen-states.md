# Screen-State Inventory — SEIP-UI-000 (AC2)

ทุกหน้าจอ × ทุกสถานะที่ work order กำหนด: empty, loading, success, validation error, upload failure, permission denied, offline/retry
`—` = สถานะนั้นไม่มีในหน้าจอนี้โดยธรรมชาติ (ระบุเหตุผลท้ายตาราง)

| Screen | empty | loading | success | validation error | upload failure | permission denied | offline/retry |
|---|---|---|---|---|---|---|---|
| **S1 หลักฐานของฉัน** | Illustration + "ยังไม่มีหลักฐาน" + CTA ปุ่มส่งชิ้นแรก | skeleton cards ×3 | list + การ์ดสถานะสแกน | — | การ์ด "อัปโหลดค้าง 43% — แตะเพื่อทำต่อ" | RES-001→ empty state พร้อมข้อความติดต่อ admin (ไม่บอกว่ามีข้อมูลอยู่) | banner ออฟไลน์ + แสดง cache ล่าสุด + retry อัตโนมัติ |
| **S2 เลือกไฟล์** | — (picker native) | — | preview ไฟล์ที่เลือก | ไฟล์ 0 byte / อ่านไม่ได้ → แจ้งเลือกใหม่ | — | ไม่ได้สิทธิ์กล้อง/คลัง → คำแนะนำเปิด permission ของ OS | — (local ทั้งหมด) |
| **S3 รายละเอียด** | — | โหลด categories: การ์ด skeleton | ฟอร์มพร้อม ค่า default ครบ | mime/size/duration ขัดกับหมวด (wording UPL-001/002/003) แสดง *ก่อน* อัปโหลด; ชื่อว่าง/ยาวเกิน 300 | — | — (ถึงหน้านี้ได้แปลว่ามีสิทธิ์) | categories มาจาก cache ได้ (ref data); ถ้าไม่มี cache → retry state |
| **S4 ผูกตัวชี้วัด** | framework ไม่มีข้อมูล → "ยังไม่เปิดใช้กรอบประเมิน" + ข้ามได้เสมอ | chips skeleton | chips เลือกได้ + นับจำนวนที่เลือก | เลือกซ้ำ indicator เดิมที่ evidence นี้ผูกแล้ว (MAP-001 preempt: disable chip + tooltip) | — | — | ใช้ cache framework ได้; ออฟไลน์ → ข้าม step นี้ได้ (ผูกทีหลัง) |
| **S5 ตรวจ + PDPA** | — | — | สรุปครบ + PDPA notice | — (แก้ไขกลับ S3) | — | — | ปุ่มยืนยัน disabled เมื่อออฟไลน์ + ข้อความ "รอสัญญาณ" |
| **S6 อัปโหลด** | — | สร้าง evidence + initiate: spinner สั้น | progress bar % จริง + "ทำต่อในพื้นหลังได้" | 4xx จาก create/initiate → กลับ S3 พร้อม error รายฟิลด์ | PUT ล้มเหลว/หลุด → auto-retry ×3 → การ์ด resume; target หมดอายุ → re-initiate เงียบ; UPL-004 → ถือว่าสำเร็จ (idempotent) | AUTH-002 กลางทาง → เก็บ state, login, กลับมาทำต่อ | ออฟไลน์กลางทาง → pause + banner + resume อัตโนมัติเมื่อออนไลน์ |
| **S7 ส่งแล้ว** | — | รอ complete ตอบ: spinner | การ์ดเขียว + สถานะสแกน pending + CTA ผูกตัวชี้วัด/กลับหน้าหลัก | UPL-005 checksum ไม่ตรง → อธิบาย + ปุ่ม "อัปโหลดใหม่" (re-initiate) | — | — | complete ค้าง → คิวไว้ retry; แสดง "กำลังยืนยันไฟล์…" |
| **หลังส่ง (async)** | — | — | notification "สแกนผ่าน ไฟล์พร้อมใช้" | — | UPL-006 blocked → notification + การ์ดแดงใน S1 + วิธีแก้ (ลบ/ส่งใหม่) | — | — |

## Cross-cutting rules

1. **Auth expiry (AUTH-001/002)**: ทุกหน้า — เก็บ draft/upload state ไว้ในเครื่องก่อนเสมอ → พาไป login → กลับหน้าที่ค้าง ห้ามทิ้งงานผู้ใช้
2. **Permission denied ระหว่าง flow** (สิทธิ์เปลี่ยนกลางทาง): แสดงเต็มหน้า ไม่ใช่ toast — อธิบายว่าเกิดอะไร + ใครช่วยได้ (school admin) + ไม่ leak ข้อมูล
3. **Retry policy ฝั่ง UI**: network error → exponential backoff ×3 อัตโนมัติแบบเงียบ, เกินนั้นแสดงปุ่ม retry ชัดเจน; 4xx business error → ไม่ auto-retry (ผู้ใช้ต้องแก้)
4. **ทุก error ที่มาจาก API** แสดงข้อความภาษาไทยที่ map จาก `code` (error-codes.yaml) — ไม่โชว์ `message` ดิบจาก server; `request_id` ซ่อนใน "รายละเอียดทางเทคนิค" expandable สำหรับแจ้งปัญหา
