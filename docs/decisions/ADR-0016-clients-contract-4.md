# ADR-0016: Clients (Flutter + เว็บ) และ contract 4.0.0

## Status
**Accepted** (2026-10-12, owner อนุมัติ; เสนอ 2026-10-12) — ดำเนินการใน P0. Amends ADR-0006 (รายละเอียดเว็บ) และ ADR-0001 (เพิ่ม Dart)

## Context
- D4: มือถือใช้ Flutter และต้องออกแบบเว็บกับมือถือคู่ขนานกัน
- งานวิจัยวัดได้ว่า Flutter Web หนักกว่า React SPA 15–30 เท่า (~2.3–3.6 MB gzip เทียบกับ ~0.11 MB), วาดบน canvas ทำให้ Ctrl+F ใช้ไม่ได้, accessibility อ่อน และพิมพ์ฟอร์มทางการยาก
- เว็บ SPA เดิม (Vite 6 + React 18) ทำงานอยู่แล้ว และไม่ต้องการ SSR
- อัปโหลดเดิมเป็น presigned PUT ครั้งเดียว ต่อไม่ได้เมื่อหลุด แต่วิดีโอ 720p ยาว 60 นาทีมีขนาดราว 0.7–0.9 GB

## Decision
1. **เว็บ**: Vite 8 + React 19 + React Router 8 SPA ใช้ได้ทุก persona. **ไม่ใช้ Next.js และไม่ใช้ Flutter Web**
2. **มือถือ**: Flutter 3.47 สำหรับถ่าย/สแกน/อัดวิดีโอ, outbox ออฟไลน์, รับไฟล์ share จากแอปอื่น และยืนยันแบบแตะครั้งเดียว
3. **Contract ชุดเดียว OpenAPI 4.0.0** สร้าง client ทั้งสองฝั่ง: TS ใช้ openapi-typescript, Dart ใช้ swagger_parser (ถ้า spike ใน P0 ไม่ผ่านให้ fallback เป็น openapi-generator)
4. **Outbox ของ Flutter**: drift + `sqlite3` 3.7 ที่เข้ารหัสด้วย SQLite3MultipleCiphers (`*_flutter_libs` เลิกพัฒนาแล้ว) และไม่ถูกรวมใน backup ของเครื่อง
5. **อัปโหลด**:
   - ไฟล์ ≤ 16 MiB ใช้ PUT ครั้งเดียว
   - ไฟล์ใหญ่กว่านั้นใช้ S3 multipart (part ละ 16 MiB) แบบ server-persisted session ซึ่ง server ปิดเองผ่าน ListParts และหมดอายุใน 7 วัน
   - วิดีโอใช้ลำดับ audio-first: ส่ง proxy เสียง AAC ก่อน แล้วตามด้วย keyframe และไฟล์วิดีโอ
6. ทุกคำขอใช้ `Idempotency-Key`, ETag/If-Match และ delta sync
7. **การแจ้งเตือน** ส่งผ่าน inbox ในแอป, FCM/APNs แบบ ping ที่ไม่มีเนื้อหา และอีเมลผ่าน SMTP ในไทย
8. operation ของ v2 (การให้คะแนน) ติด tag และไม่อยู่ใน bundle ของ client

## Consequences
- stack มี TypeScript, Dart และ Python (ADR-0010)
- นักพัฒนาคนเดียวต้องดูแลสองแอป แผนจึงต้องมี cut list และผู้รับจ้าง Flutter เป็นตัวเลือก
- ต้องเริ่มยืนยันตัวตนนักพัฒนากับ Apple (D-U-N-S) และ Google ตั้งแต่ P0 เพราะ Android บังคับ developer verification ในไทยตั้งแต่ 30 ก.ย. 2569

## Approved By
รอ owner อนุมัติ

## Date
2026-10-12
