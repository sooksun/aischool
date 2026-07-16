# Evidence Submission UX — SEIP-UI-000

Status: Design v0.1 (no implementation) · Date: 2026-07-17 · Mode: single-agent (ADR-0004)
Companions: [`evidence-flow.mmd`](./evidence-flow.mmd) · [`screen-states.md`](./screen-states.md) · [`field-contract-trace.md`](./field-contract-trace.md)

## Design goal

**ครูส่งหลักฐานจากมือถือได้ใน 1–2 นาที** ด้วยฟิลด์บังคับน้อยที่สุด: ไฟล์ + หมวด + ชื่อ (ชื่อถูกเติมให้จากชื่อไฟล์ — ผู้ใช้แค่ยืนยันหรือแก้) การผูกตัวชี้วัดเป็น *ทางเลือก* ณ ตอนส่ง และทำย้อนหลังได้เสมอ — สอดคล้องหลัก "upload once, reuse through governed mappings"

## Steps (S1–S7)

| Step | หน้าจอ | ฟิลด์/การกระทำ | API |
|---|---|---|---|
| S1 | หลักฐานของฉัน | list ของตัวเอง (default owner=self) + FAB | `listEvidence` |
| S2 | เลือกไฟล์ | ถ่ายรูป/วิดีโอ, คลังภาพ, ไฟล์เอกสาร | — (native picker) |
| S3 | รายละเอียดขั้นต่ำ | การ์ดหมวด 5 ใบ (จาก categories พร้อม validation meta) + ชื่อ auto-fill | `listEvidenceCategories` |
| S4 | ผูกตัวชี้วัด (ข้ามได้) | chips ตัวชี้วัดจาก framework ที่ตรงกับผู้ใช้ ค้นหา/หมวดหมู่ตามด้าน | `listFrameworks`, `getFramework` |
| S5 | ตรวจ + PDPA | สรุป + ข้อความแจ้งข้อมูลส่วนบุคคล (ดูล่าง) | — |
| S6 | อัปโหลด | สร้าง evidence → initiate → PUT ตรงสู่ storage (progress, พื้นหลัง, resume) → complete | `createEvidence`, `initiateFileUpload`, `completeFileUpload` |
| S7 | ส่งแล้ว | การ์ดสรุป + สถานะสแกน + ปุ่ม "ผูกตัวชี้วัดเพิ่ม" | `createMapping` (จาก S4/S7) |

**Client-side validation ก่อนอัปโหลด** ใช้ metadata จาก `EvidenceCategory` (`allowed_mime_types`, `max_byte_size`, `max_duration_seconds`) — ผู้ใช้รู้ว่าวิดีโอยาวเกิน 10 นาที *ก่อน* เสียเวลาอัปโหลด; server ยังคง validate ซ้ำ (UPL-001..003)

## Low-fi wireframes (mobile 360×800 reference)

```
S1 หลักฐานของฉัน            S3 รายละเอียด                S5 ตรวจ + PDPA
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│ หลักฐานของฉัน  🔔 │        │ ← รายละเอียด      │        │ ← ตรวจสอบ         │
│ [ค้นหา________]   │        │ ไฟล์: VID_0123.mp4│        │ ▶ VID_0123.mp4    │
│ ┌──────────────┐ │        │ 128MB · 08:12     │        │ หมวด: วิดีโอการสอน │
│ │▶ วิดีโอสอนคณิต│ │        │ หมวดหลักฐาน *     │        │ ชื่อ: สอนคณิต ป.5   │
│ │  ✓สแกนแล้ว    │ │        │ ┌────┐┌────┐      │        │ ตัวชี้วัด: T-1.3    │
│ │  T-1.3, T-1.7 │ │        │ │📄  ││🎬▣ │      │        │ ┌────────────────┐│
│ └──────────────┘ │        │ │แผน ││วิดีโอ│ ...  │        │ │⚠ ข้อมูลส่วนบุคคล ││
│ (การ์ดถัดไป...)   │        │ └────┘└────┘      │        │ │วิดีโอนี้อาจติดภาพ ││
│                  │        │ ชื่อหลักฐาน *      │        │ │ผู้เรียน โปรดตรวจ…││
│                  │        │ [สอนคณิต ป.5___]  │        │ └────────────────┘│
│         ( + ส่ง )│        │        [ถัดไป →]  │        │ [แก้ไข] [ยืนยันส่ง]│
└──────────────────┘        └──────────────────┘        └──────────────────┘
```

S6 อัปโหลด: แถบ progress + "อัปโหลดต่อในพื้นหลังได้ ปิดหน้านี้ได้เลย" + ปุ่มยกเลิก · S7: การ์ดเขียว + "กำลังสแกนไฟล์ ผลจะแจ้งเตือน"

## Responsive intent (AC4)

- **Mobile-first**: single column, stepper แนวตั้ง, FAB, การ์ดหมวดเป็น grid 2 คอลัมน์, ปุ่มหลักเต็มความกว้างติดขอบล่าง (thumb zone)
- **Tablet/Desktop reflow**: stepper กลายเป็นแนวนอนด้านบน; S3+S4 รวมเป็นสองคอลัมน์ (ฟอร์มซ้าย ตัวชี้วัดขวา); list กลายเป็นตาราง + filter bar; FAB กลายเป็นปุ่มหัวหน้า
- **Upload path บนมือถือ**: `<input capture>` เปิดกล้องตรง; อัปโหลดผ่าน presigned URL เป็น background task; ออกจากหน้าได้โดย state ค้างอยู่ (S1 แสดงการ์ด "กำลังอัปโหลด 43%")

## Large-file & resume UX (AC6 — recorded risk)

1. Progress จริงจาก PUT ตรงสู่ storage (ไม่ผ่าน API server)
2. หลุด/ออฟไลน์ → เก็บ state (evidence_id, file_id, byte offset ถ้า provider รองรับ, checksum) ใน local storage → auto-retry เมื่อออนไลน์ (แสดง banner "จะอัปโหลดต่ออัตโนมัติ")
3. Upload target หมดอายุ (`expires_at`) → เรียก initiate ใหม่เงียบ ๆ แล้วอัปโหลดต่อ/เริ่มใหม่ตาม provider
4. Checksum คำนวณแบบ streaming ระหว่างเตรียมไฟล์ (แสดง "กำลังเตรียมไฟล์…" สำหรับ mp4 ใหญ่) — UPL-005 ป้องกันไฟล์เพี้ยน
5. วิดีโอ: อ่าน duration จาก `<video>` metadata; ถ้าอ่านไม่ได้ ส่ง null และให้ server probe ตัดสิน (ดู CCR-002)

## PDPA notice (AC6 — recorded risk)

แสดงทุกครั้งใน S5 แบบย่อ + ลิงก์ฉบับเต็ม:
> "หลักฐานอาจมีข้อมูลส่วนบุคคลของผู้เรียน (ภาพ เสียง ชื่อ ผลงาน) ระบบเก็บไฟล์อย่างปลอดภัยและเข้าถึงได้เฉพาะผู้เกี่ยวข้องกับการประเมินของคุณ โปรดหลีกเลี่ยงข้อมูลอ่อนไหวที่ไม่จำเป็น เช่น เลขบัตรประชาชน ข้อมูลสุขภาพ"

ไม่ใช่ checkbox บังคับ (ครูส่งบ่อย ความล้าจะทำให้ติ๊กโดยไม่อ่าน) แต่เป็นข้อความคงที่ + การกด "ยืนยันส่ง" บันทึกว่าได้แสดงข้อความเวอร์ชันใดใน audit trail ฝั่ง server

## Accessibility intent (AC5 — setup for SEIP-UI-001 checks)

| ด้าน | Intent (จะกลายเป็น automated check ใน UI-001) |
|---|---|
| Focus order | ตามลำดับอ่าน: header → เนื้อหา → ปุ่มหลัก; ใน stepper โฟกัสแรกไปที่ฟิลด์แรกของ step; error → โฟกัสย้ายไป error แรก |
| Labels | ทุก input มี `<label>` จริง (ไม่ใช่ placeholder-as-label); การ์ดหมวด = radio group มี `aria-label` เป็นชื่อหมวดภาษาไทย |
| Error announcement | error รายฟิลด์ + summary เป็น `role=alert`/`aria-live=assertive`; ข้อความจับคู่รหัส UPL-* เป็นภาษาคน ("วิดีโอยาว 12:30 นาที เกินกำหนด 10:00 นาที") |
| Progress | แถบอัปโหลดเป็น `role=progressbar` + `aria-valuenow`; สถานะเปลี่ยน (สแกนเสร็จ) ประกาศผ่าน `aria-live=polite` |
| Target size | ปุ่ม/การ์ดแตะได้ ≥ 44×44px; FAB 56px; ระยะห่างการ์ด ≥ 8px |
| Contrast | ข้อความปกติ ≥ 4.5:1, ใหญ่ ≥ 3:1; ห้ามสื่อสถานะด้วยสีอย่างเดียว (สแกน pending/clean/blocked มีไอคอน+ข้อความ) |
| ภาษา | UI ภาษาไทยเป็นหลัก; `lang=th` ราก; ชื่อไฟล์/ตัวเลขคง format เดิม |

## Out of scope (deferred โดยเจตนา)

- หน้าจอ review/confirm ของผู้บริหารและกรรมการ (ใช้ contract เดียวกัน ออกแบบใน Sprint 1 พร้อม scoring UX)
- AI-suggest ตัวชี้วัด (Sprint 2, OPEN-3) — S4 ออกแบบเผื่อ: ตำแหน่ง chips รองรับ "แนะนำโดยระบบ" badge
- Report generation UX (contract v0.2)
