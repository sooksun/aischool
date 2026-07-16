> **SUPERSEDED by ADR-0004 (2026-07-17).** SEIP is developed solely by Claude Code.
> This file is kept for historical reference and possible future multi-agent revival.
> See docs/decisions/ADR-0004-single-agent-development.md

# Dispatch Template — ข้อความมอบงานให้ AI Agent

ใช้เมื่อ task บน board เปลี่ยนเป็น `ready` และ dependencies ครบแล้วเท่านั้น
แทนค่า `<...>` แล้ววางลงใน session ใหม่ของ agent นั้น (เปิด session ที่ repo root เสมอ)

---

คุณได้รับ Work Order จาก Claude Code (Lead Architect) — Task: <TASK-ID>

ลำดับการอ่าน (ต้องอ่านครบก่อนแตะไฟล์ใด ๆ):
1. <AGENT-INSTRUCTION-FILE>            เช่น AGENTS.md / ANTIGRAVITY.md / GROK.md
2. .ai-team/task-board.yaml            ยืนยันว่า task นี้ owner คือคุณ และ status = ready
3. .ai-team/work-orders/<TASK-ID>.md   ขอบเขตงาน, allowed/blocked paths, acceptance criteria
4. เอกสารใน Dependencies ของ Work Order ทุกไฟล์

กติกา:
- ทำเฉพาะ <TASK-ID> เท่านั้น ห้ามหยิบงานอื่นจาก board
- แก้ไฟล์ได้เฉพาะใน allowed_paths — ถ้าจำเป็นต้องแตะไฟล์นอกนั้น ให้หยุดและรายงาน ห้ามแก้เอง
- ก่อนเริ่ม: เปิด branch ตามชื่อใน board และลงทะเบียนไฟล์ที่จะแก้ใน .ai-team/file-locks.yaml
- ถ้า contract ไม่พอ: เขียน Contract Change Request (.ai-team/templates/contract-change-request.md) แล้วหยุดรอ — ห้าม invent field เอง
- ห้ามแก้ .ai-team/task-board.yaml (Claude เป็นคนอัปเดตสถานะ) ยกเว้น file-locks.yaml และ handoffs/ ของตัวเอง
- ห้ามอ้างว่างานเสร็จโดยไม่แสดงผลลัพธ์ของ Verification Commands ใน Work Order

เมื่อเสร็จ:
- เขียน .ai-team/handoffs/<TASK-ID>.md ตาม template
- สรุปสั้น ๆ: ไฟล์ที่สร้าง/แก้, ผล verification, ข้อจำกัด/assumption, CCR ที่เปิด (ถ้ามี)
- แจ้งกลับเพื่อให้ reviewer (<REVIEWER>) ตรวจ — สถานะจะถูกเปลี่ยนเป็น review_requested โดย Claude

---

## หมายเหตุการใช้งานต่อ agent

| Agent | Instruction file | วิธีส่ง |
|---|---|---|
| Codex | `AGENTS.md` (root — อ่านอัตโนมัติ) | เปิด `codex` ที่ repo root แล้ววางข้อความ |
| Antigravity | `ANTIGRAVITY.md` (ระบุ path ในข้อความเสมอ) | วางในแชตของ Antigravity โดยเปิดโปรเจกต์ที่ repo root |
| Grok CLI | `GROK.md` (ระบุ path ในข้อความเสมอ) | เปิด grok ที่ repo root แล้ววางข้อความ |

ก่อน SEIP-OPS-001 เสร็จ: ไฟล์ instruction ยังอยู่ใต้ `docs/` — ต้องอ้าง path เต็ม (`docs/AGENTS.md`, `docs/.ai-team/...`) ในข้อความ dispatch
