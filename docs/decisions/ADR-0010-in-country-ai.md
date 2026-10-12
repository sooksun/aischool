# ADR-0010: AI ในประเทศไทยด้วย open-weight model ที่ host เอง และ pipeline คำแนะนำแบบ async

## Status
**Proposed** (2026-10-12). ต้องได้รับอนุมัติจาก owner ใน P0. Supersedes ADR-0007 ทั้งขอบเขตผู้ให้บริการ AI และ contract `suggestMappings` แบบ synchronous. Amends ADR-0001 โดยเพิ่ม Python เข้า stack

## Context

ADR-0007 จำกัด "AI" ไว้ที่ `local_heuristic` ซึ่งนับคำซ้ำระหว่างชื่อ/คำอธิบายหลักฐานกับชื่อตัวชี้วัด โดยไม่อ่านเนื้อหาไฟล์เลย วัตถุประสงค์หลักของผลิตภัณฑ์คือ "ส่งหลักฐานครั้งเดียว ใช้ได้หลายตัวชี้วัด จัดการโดย AI หลังบ้าน" จึงยังไม่เคยเกิดขึ้นจริง

Owner ตัดสินใจเมื่อ 2026-10-12 (D1) ว่า **การประมวลผล AI ทั้งหมดต้องอยู่ในประเทศไทย ด้วย open model ที่ host เอง** ห้ามใช้ผู้ให้บริการ AI ต่างประเทศหรือ cloud AI. งานวิจัยยืนยันว่าไม่มี Claude deployment ใดที่ประมวลผลในไทย (`inference_geo` มีแค่ `global`/`us`) ทางเลือก cloud AI จึงถูกตัดออกโดย D1

ข้อเท็จจริงที่ใช้ตัดสินใจ (รายละเอียดใน `docs/architecture/design-brief-2026-10.md` §AI pipeline):
- open model ที่ license สะอาดและเก่งภาษาไทยมีแล้ว ได้แก่ Gemma 4 31B, Qwen3.6-27B และ Qwen-SEA-LION-v4.5-27B (คะแนน SEA-HELM Thai ห่างกันไม่ถึง 1.5 จุด). Public benchmark จึงเลือกให้ไม่ได้
- คุณภาพในงานของ SEIP (จับคู่หลักฐานหลาย label เทียบ rubric ภาษาไทย) **ยังไม่มีใครวัด** คาดว่าต่ำกว่าโมเดลปิดระดับแนวหน้าราว 5–15 macro-F1 (ความมั่นใจต่ำ)
- AWS และ GCP ใน Bangkok ไม่มี GPU
- vLLM + xgrammar บังคับ JSON schema ได้

## Decision

1. **AI ทุกส่วน** (OCR, ASR, embeddings, คำบรรยายภาพ, การจับคู่) รันบน GPU ที่ผู้ให้บริการควบคุม ซึ่งตั้งอยู่ในศูนย์ข้อมูล Bangkok (ADR-0011) ใช้ open-weight model ที่ pin revision ไว้ ผ่าน vLLM และ faster-whisper. **ห้ามใช้ AI API ภายนอกหรือของต่างประเทศ**
2. **Model packs** (เลือกขั้นสุดท้ายใน ADR-0019 หลัง bake-off):
   - Mapper แบบ fast: MoE (Qwen3.6-35B-A3B FP8 เป็นตัวแรก) ทุกชิ้นงาน → cascade ไป dense 27–31B เมื่อความมั่นใจต่ำ, locator ไม่ถูกต้อง, พบสัญญาณ injection หรือวิดีโอยาวกว่า 30 นาที
   - Perception: Typhoon OCR 1.5, Typhoon Whisper (large-v3 / turbo ช่วงพีค), BGE-M3
   - มี **Pack G** (น้ำหนักโมเดลที่ไม่ใช่ต้นกำเนิดจีนทั้งชุด: Gemma 4, Whisper-lineage ASR, multilingual-e5, Gemma/Tesseract OCR) ผ่าน quality gate เดียวกัน เผื่อผู้ซื้อกำหนด
3. **Contract แบบ async** (OpenAPI 4.0.0, ADR-0016): operation สำหรับ analysis และ suggestion รวมถึง internal lease API แบบ pull-only ผ่าน mTLS. **GPU node ไม่มี credential ของฐานข้อมูล** และไม่เปิด inbound port
4. **Prompt** ใส่ตัวชี้วัด **ครบทั้ง 18 ตัว** ของ role family (15 ตัวในส่วนที่ 1 + ประเด็นท้าทาย 3 รายการ) ที่ระดับวิทยฐานะของผู้ถูกประเมิน (เฉพาะข้อความระดับที่คาดหวัง ~1.3–2.7k tokens) จึงมี stable prefix เพียง 10 แบบต่อ framework version. ใช้ BGE-M3 shortlist เพื่อจัดอันดับเท่านั้น **ไม่ใช้ตัดตัวชี้วัดทิ้ง**
5. **Output** ถูกบังคับด้วย xgrammar: `indicator_code` เป็น enum ของรหัสใน role family และ `segment_id` เป็น enum ของ segment ที่ส่งเข้าไปจริง. Quote ตรวจที่ server ใน Bangkok ด้วย fuzzy match บนข้อความไทยที่ normalise แล้ว. Locator ที่แสดงผู้ใช้มาจาก segment ที่เก็บไว้เสมอ ไม่ใช่พิกัดที่โมเดลเขียน
6. **Calibration** แบบ isotonic ต่อประเภทหลักฐาน
7. **Suggestion เก็บแยก** ในตาราง `ai_suggestion` ไม่อยู่ในตาราง mapping ที่ถูกกำกับ และ **ไม่ auto-confirm เด็ดขาด**
8. `local_heuristic` คงไว้เป็นโหมดสำรองเมื่อ AI ไม่พร้อม และเป็น floor สำหรับวัดผล
9. **AI ปิดเป็นค่าเริ่มต้น** จนกว่าจะผ่าน gate ต่อประเภทหลักฐานใน ADR-0019 (PRD NFR-AIQ-*) ก่อนหน้านั้นใช้โหมด "เสนอเมื่อขอ · ทดลอง"
10. **GPU tier ไม่เก็บข้อมูลใดๆ**: ปิด request log ของ vLLM, ล้าง tmpfs หลังทุก job, รับ input ผ่าน presigned GET อายุ 15 นาที. **Egress ปิดเป็นค่าเริ่มต้น** (nftables) พิสูจน์ด้วย probe ตามกำหนดเวลาและสัญญาณเตือนเมื่อ ruleset hash เปลี่ยน

## Options Considered

1. **Self-hosted open models ในไทย (เลือก)** — ตรงตาม D1. แลกกับคุณภาพที่ยังไม่ได้วัดและภาระดูแล GPU
2. Claude ผ่าน Anthropic API / Claude Platform on AWS พร้อมลบข้อมูลส่วนบุคคลก่อนส่ง — คุณภาพสูงสุด แต่ข้อมูลออกนอกประเทศ **ขัดกับ D1**
3. Claude บน Bedrock (Global profile จาก Bangkok) — ขัด D1 และไม่รองรับ structured outputs
4. คง `local_heuristic` ต่อไป — ไม่บรรลุวัตถุประสงค์หลักของผลิตภัณฑ์

## Consequences

- เพิ่ม Python (extract tier + ai-runner) เข้า stack. Backend หลักยังเป็น TypeScript
- ต้องสร้าง gold set (~600 ชิ้น ติดป้ายโดยผู้ประเมินมีประสบการณ์ 3 คน + คนที่ 4 ตัดสิน) ใน P2–P5 ก่อนเปิด AI ให้ใช้จริง
- ถ้าบางประเภทหลักฐานไม่ผ่าน gate ประเภทนั้นจะเปิดใช้โดยปิด AI ไว้ (PRD NFR-AIQ-07)
- ความเสี่ยง: prefix caching ของ Qwen hybrid ใน vLLM ยังเป็น experimental (hit rate 0–79%). Prefix ที่สั้น (~2k tokens) ลดผลกระทบ ถ้ายังไม่พอให้เลือก Gemma 4
- Fine-tuning (LoRA) จาก confirm/reject ทำได้เฉพาะข้อมูลที่ได้รับความยินยอมแยกต่างหาก และตัดสินใน P7

## Approved By
รอ owner อนุมัติ (เสนอโดย Claude Code, 2026-10-12)

## Date
2026-10-12
