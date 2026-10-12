# ADR-0018: ความถูกต้องของไฟล์อัปโหลด และนโยบายมัลแวร์สำหรับสื่อขนาดใหญ่

## Status
**Accepted** (2026-10-12, owner อนุมัติ; เสนอ 2026-10-12) — ดำเนินการใน P2. Amends ADR-0009

## Context
- ADR-0009 สแกนด้วย ClamAV แบบ fail-closed และ block ไฟล์ที่ใหญ่เกิน `CLAMAV_MAX_BYTES` (ค่าเริ่มต้น 25 MiB). ผลคือ**วิดีโอสอนจริงทุกไฟล์จะถูกกักไว้**เมื่อเปิดการสแกน
- ค่าเริ่มต้น `SCAN_PROVIDER=none` ปล่อยให้ดาวน์โหลดไฟล์ที่ยังไม่ได้สแกนได้
- `clamd.conf.sample` (ClamAV 1.4) ระบุว่า **"ข้อจำกัดของการออกแบบทำให้ ClamAV สแกนไฟล์ที่ใหญ่กว่า 2 GB ไม่ได้"**. คอมเมนต์ใน `apps/worker/src/env.ts` ที่บอกว่า StreamMaxLength ค่าเริ่มต้นคือ 25 MB นั้นล้าสมัย (ค่าเริ่มต้นจริงคือ 100M)
- ความยาววิดีโอปัจจุบันใช้ค่าที่ client ส่งมาเท่านั้น

## Decision
1. **server คำนวณ SHA-256 และขนาดใหม่ทุกไฟล์** ถ้าไม่ตรงกับที่ client แจ้งให้ block
2. **ClamAV แบบ fail-closed** สแกนเอกสาร รูปภาพ และไฟล์บีบอัด ขนาดไม่เกิน **1.9 GB**. ต้องปรับ `StreamMaxLength` กับ `CLAMAV_MAX_BYTES` ให้สอดคล้องกัน
3. **เสียงและวิดีโอ** ผ่าน content disarm: ตรวจด้วย ffprobe แบบเข้มงวด แล้ว transcode ที่ server. **ความยาวที่ใช้คือค่าจาก ffprobe** ไม่ใช่ค่าจาก client
4. **คนอื่นที่ไม่ใช่เจ้าของได้รับเฉพาะ rendition ที่ server สร้างเท่านั้น**
5. ไฟล์ต้นฉบับที่ใหญ่กว่า 2 GB ติดสถานะ "ต้นฉบับที่ยังไม่ได้สแกน" และเจ้าของเท่านั้นที่อ่านได้
6. **การสแกนบางส่วน (head/tail) ไม่ถือเป็น fail-closed เด็ดขาด**
7. derivative ทุกไฟล์ต้องลบ EXIF. PDF ใช้ pikepdf ลบ JavaScript และไฟล์แนบ. ระบบตรวจ hidden text จากความต่างระหว่าง text layer กับผล OCR แล้วติดธง `instruction_like_text`
8. **ห้ามใช้ `SCAN_PROVIDER=none` ใน production**

## Consequences
- ต้องเพิ่ม extract tier ภาษา Python (ffmpeg 8.1). ffmpeg ที่ build แบบ GPL พร้อม libx264 ใช้ได้เฉพาะในบริการที่ผู้ให้บริการรันเอง. ถ้าส่ง image ให้ สพท. ต้องเปลี่ยนเป็น libopenh264 หรือ h264_nvenc หรือแนบ source offer (ให้ที่ปรึกษากฎหมายยืนยัน)
- สถานะ `scanned_at` (ADR-0009 addendum) ยังใช้ต่อ

## Approved By
รอ owner อนุมัติ

## Date
2026-10-12
