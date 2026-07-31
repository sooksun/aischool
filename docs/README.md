# AI School Multi-Agent Development Docs

เอกสารควบคุมการพัฒนาระบบ School Evidence Intelligence Platform (SEIP) โดยใช้ Claude Code, Codex, Antigravity และ Grok CLI ทำงานร่วมกันโดยไม่ทับซ้อนกัน

## โครงสร้างหลังจาก SEIP-OPS-001

เอกสารชุดนี้ไม่ใช่โฟลเดอร์ที่ต้องคัดลอกอีกต่อไป — repository นี้คือของจริง (ADR-0002)
งานติดตั้งคือ `git clone` แล้วทำงานบน branch ของตัวเองตาม `.ai-team/task-board.yaml`

"ระบบปฏิบัติการ" ของทีมอยู่ที่ **root ของ repository** เพราะเครื่องมือของแต่ละ agent
โหลดไฟล์จากตำแหน่งนั้น ส่วน `docs/` เก็บเอกสารสำหรับมนุษย์อ่าน

| ที่อยู่ | เก็บอะไร |
|---|---|
| `/CLAUDE.md` `/AGENTS.md` `/ANTIGRAVITY.md` `/GROK.md` | คำสั่งของแต่ละ agent (โหลดจาก root) |
| `/.ai-team/` | กระดานงาน เจ้าของโมดูล file locks work orders handoffs templates |
| `/.github/` | CODEOWNERS, PR template, CI gates |
| `/scripts/orchestration/` | ตัวตรวจความถูกต้องของระบบแบ่งงาน |
| `docs/` | architecture, contracts, decisions, qa, reviews, project |

## เอกสารเริ่มต้น
- [`../CLAUDE.md`](../CLAUDE.md) — คำสั่งสำหรับ Claude Code
- [`../AGENTS.md`](../AGENTS.md) — คำสั่งสำหรับ Codex
- [`../ANTIGRAVITY.md`](../ANTIGRAVITY.md) — คำสั่งสำหรับ Antigravity
- [`../GROK.md`](../GROK.md) — คำสั่งสำหรับ Grok CLI
- [`../.ai-team/task-board.yaml`](../.ai-team/task-board.yaml) — กระดานงานกลาง
- [`../.ai-team/module-ownership.yaml`](../.ai-team/module-ownership.yaml) — เจ้าของโมดูล (แหล่งอ้างอิงหลักเรื่องสิทธิ์ review)
- [`../.ai-team/file-locks.yaml`](../.ai-team/file-locks.yaml) — ระบบล็อกไฟล์
- [`project/MULTI-AI-DEVELOPMENT-PLAN.md`](project/MULTI-AI-DEVELOPMENT-PLAN.md) — แผนการทำงานฉบับเต็ม
- [`project/SPRINT-0.md`](project/SPRINT-0.md) — Sprint 0 และ Definition of Ready to Build

## ตรวจสอบว่าระบบแบ่งงานยังถูกต้อง

```bash
node scripts/orchestration/validate-ownership.mjs   # ทุก path มีเจ้าของเดียว
node scripts/orchestration/validate-gates.mjs       # ทุก gate มี CI job
```

ทั้งสองคำสั่งรันอัตโนมัติในงาน **Orchestration integrity** ของ CI ทุก pull request
