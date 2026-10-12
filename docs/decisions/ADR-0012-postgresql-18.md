# ADR-0012: PostgreSQL 18 + pgvector เป็นฐานข้อมูลหลัก

## Status
**Accepted** (2026-10-12, owner อนุมัติ; เสนอ 2026-10-12) — ดำเนินการใน P0 สัปดาห์ที่ 1. Supersedes ADR-0008 (MySQL 8)

## Context
- ADR-0008 ย้ายไป MySQL 8 เพื่อใช้ MySQL ของ Laragon บนเครื่อง dev
- **CI บน branch L2 ไม่เคยผ่านเลย: ล้มทั้ง 18/18 runs** ด้วย `ERROR 1419 (You do not have the SUPER privilege and binary logging is enabled)` ที่ migration `20260718210100_constraints` query 11 (run 29723268894, job 88290602232). Test ผ่านเฉพาะบน Laragon ที่รันเป็น root. ต้นเหตุคือการออกแบบด้วย trigger บน MySQL ที่มี binlog
- v1 ต้องใช้ partial unique index, vector (dedup และจัดอันดับตัวชี้วัด), `SKIP LOCKED` สำหรับ job lease และ RLS เป็น backstop. ทั้งหมดนี้ PostgreSQL ทำได้โดยตรง
- migration ของ develop บน PostgreSQL ยังผ่าน migration-validation อยู่ (PR #3 run 38219874189)

## Decision
1. **PostgreSQL 18** บน RDS Multi-AZ ใน ap-southeast-7. ถ้า region ยังไม่มี 18 ให้ใช้ **PG17** (ยังไม่ได้ยืนยันว่า region นี้มี PG18 ต้องตรวจใน P1)
2. **pgvector** ใช้ `halfvec` กับ HNSW index
3. ใช้ **partial unique index แทน trigger**, `SKIP LOCKED` สำหรับ lease, **RLS backstop แยกตาม สพท.** (`controller_area_id`)
4. **Role**: `seip_migrator` (ไม่ใช่ superuser) รัน migration และ `seip_app` (ไม่ใช่เจ้าของตาราง) รันแอป. Audit แบบ append-only ใช้ REVOKE ร่วมกับ trigger ที่ migrator เป็นเจ้าของ
5. **Prisma 7.10** ใช้ raw-SQL migration และ TypedSQL สำหรับ query vector. ต้อง pin CLI เพราะ tag `latest` ของ npm ชี้ไปที่ 8.0.0-rc
6. **Rebaseline migration** จาก `20260716234600_constraints` ของ develop (partial unique, ไม่มี trigger) ไม่ port migration ของ MySQL
7. นักพัฒนาใช้ PG18 ใน Docker หรือติดตั้งตรง **เลิกใช้ MySQL ของ Laragon** สำหรับโปรเจกต์นี้

## Options Considered
1. **PostgreSQL 18 (เลือก)** — CI ผ่านได้ภายใต้ role ที่ไม่ใช่ superuser และรองรับ vector, RLS และ partial index
2. แก้ MySQL ให้ผ่าน CI (`log_bin_trust_function_creators`) — แก้แค่อาการ ยังไม่มี vector, RLS และ partial index
3. MySQL 9 VECTOR — ยังไม่มี RLS และต้องรื้อ trigger อยู่ดี

## Consequences
- ทุก gate ที่ใช้ฐานข้อมูลต้องเขียวบน PG18 ภายใต้ `seip_migrator` เป็น **ครั้งแรกของโค้ดชุดนี้** (exit criteria ของ P0)
- เครื่อง Laragon ของ owner ต้องติดตั้ง PostgreSQL (Docker Desktop หรือ native installer)
- test ใน `tests/backend/*` ต้องเปลี่ยนจาก mysql2 กลับเป็น pg และ map errno ใหม่

## Approved By
รอ owner อนุมัติ

## Date
2026-10-12
