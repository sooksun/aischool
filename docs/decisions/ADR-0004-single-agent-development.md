# ADR-0004: Single-Agent Development — Claude Code เขียนคนเดียว

## Status
Accepted

## Context

แผนเดิม (team-charter, MULTI-AI-DEVELOPMENT-PLAN, ADR-0002) ออกแบบระบบปฏิบัติการสำหรับ 4 agents (Claude/Codex/Antigravity/Grok) — task board แบบ multi-owner, file locks, dispatch prompts, handoffs ข้าม agent, CCR loop, CODEOWNERS attribution ต่อ agent

การใช้งานจริงใน Sprint 0 พิสูจน์ว่า **overhead สูงเกินประโยชน์**: การ dispatch Codex เกิด out-of-wave execution (DB-000 รันก่อน dependency พร้อม), การเขียน dispatch prompt ต่อ task เป็นภาระของ user, และ agent หลายตัวใช้ working tree เดียวกันโดยไม่มี isolation จริง User ตัดสินใจ 2026-07-17: ใช้ Claude Code ตัวเดียว

## Decision

1. **Claude Code เป็นผู้พัฒนาเพียงตัวเดียว** ครบทุกบทบาท: architecture, backend, frontend, QA/security
2. **สิ่งที่คงไว้** (มีคุณค่าแม้ทำคนเดียว):
   - ADR สำหรับการตัดสินใจสถาปัตยกรรม (ADR-0001..0003 ยังมีผลทุกข้อ)
   - Contract-first แบบเบา: ร่าง `docs/contracts/**` ก่อน implement เพื่อ codegen types และกัน UI/API เพี้ยนกัน — แต่ approval loop ยุบเหลือ self-review + user อนุมัติ
   - Task board เป็น tracker เดียว (owner ทุก task = claude)
   - Quality gates ใน CI (docs/qa/QUALITY-GATES.md) — เปิดใช้จริงตามลำดับใน Sprint 1
   - หลัก "no production feature ก่อน contracts/ERD พร้อม" ยังบังคับใช้
3. **สิ่งที่เลิกใช้**: file locks, dispatch template, handoff ข้าม agent, CCR ระหว่าง agent, การแบ่ง module ownership ต่อ agent, branch convention แยกตาม agent (เหลือ `feat/<task-id>-<name>` ธรรมดา), review โดย Grok
4. **ไฟล์ instruction ของ agent อื่น** (AGENTS.md, ANTIGRAVITY.md, GROK.md) ติด banner superseded — ไม่ลบ เผื่อกลับมาใช้ multi-agent ในอนาคต
5. **Review กลไกใหม่**: Claude self-review ต่อ task + user เป็นผู้อนุมัติสุดท้าย (ผ่าน PR หรือตรวจใน working tree ตามความสะดวกของ user)

## Options Considered

1. **Claude Code ตัวเดียว** — เลือก: เร็วสุด, ไม่มี coordination cost, คุณภาพขึ้นกับ gate อัตโนมัติ + user review
2. คง multi-AI แต่ลดพิธีกรรม — ยังต้องเขียน dispatch เอง, ปัญหา shared working tree ไม่หาย
3. Multi-agent ภายใน Claude Code (subagents) — เป็นไปได้ภายหลังโดยไม่ต้องมีพิธีกรรมไฟล์เลย เพราะ orchestration อยู่ใน session เดียว; ไม่ต้องตัดสินใจตอนนี้

## Consequences

- งานที่ Codex ทำไว้ (data-model v0.1, CCR-001) ยังใช้ต่อ — Claude รับเป็นเจ้าของและจะ review/แก้เอง; CCR-001 ปิดโดยการที่ Claude ทำ ARCH-001 เอง
- SEIP-UI-000 (UX design) และ SEIP-QA-001 (gates) กลายเป็นงานของ Claude
- SEIP-QA-002 (adversarial review ข้าม agent) ยกเลิกในฐานะ task แยก — กลายเป็น self-review + user approval ก่อน contract lock
- Sprint 0 exit gate ("Definition of Ready to Build") ยังอยู่ แต่รายการข้อที่อ้าง multi-agent ถูกตีความใหม่ตาม ADR นี้
- ระบบ .ai-team/ เหลือแค่ task-board.yaml + work-orders (เป็น task spec) + templates/adr.md

## Approved By
User (2026-07-17), recorded by Claude

## Date
2026-07-17
