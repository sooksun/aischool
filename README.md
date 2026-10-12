# SEIP — School Evidence Intelligence Platform

ระบบเก็บหลักฐาน ผูกตัวชี้วัด และประเมินผลการปฏิบัติงานตามข้อตกลง (วPA) สำหรับสถานศึกษา
รองรับกรอบประเมิน **ว9/2564 (ครู)** และ **ว10/2564 (ผู้บริหารสถานศึกษา)** โดยเก็บเกณฑ์ทั้งหมดเป็น *ข้อมูล* (versioned data) ไม่ hard-code ในโค้ด (ADR-0003)

> สถานะ: Sprint 1 เสร็จสมบูรณ์ — product slice ทำงานครบวงจร ผ่านการทดสอบทุกชั้นรวม e2e ดูรายละเอียดที่ [docs/project/PROJECT_STATE.md](docs/project/PROJECT_STATE.md)

## ระบบทำงานอย่างไร

ขั้นตอนการใช้งานจริงตามบทบาท:

1. **ครู** เข้าสู่ระบบ → อัปโหลดหลักฐาน (PDF/รูป/วิดีโอ) — ไฟล์ขึ้น MinIO ตรงผ่าน presigned URL ไม่ผ่านตัว API
2. **Worker** สแกนไฟล์ (virus scan + วัดความยาววิดีโอ) — ดาวน์โหลดได้เฉพาะไฟล์ที่สแกนผ่าน (`clean`)
3. ครูผูกหลักฐานเข้ากับ**ตัวชี้วัด** (T-1.1 … T-3.3 / A-1.1 … A-5.2) เอง หรือให้ระบบ**แนะนำอัตโนมัติ** (AI แบบ local heuristic — ไม่ส่งข้อมูลออกนอกเครื่อง ตาม ADR-0007) แล้ว**ผู้อำนวยการยืนยัน** (governance: ครูยืนยัน mapping ของตัวเองไม่ได้)
4. **ผอ.** สร้างรอบการประเมิน (cycle/round) และตั้ง**คณะกรรมการ 3 คน**ต่อผู้รับการประเมิน (ประธาน 1 + กรรมการ 2)
5. กรรมการแต่ละคนให้คะแนนรายตัวชี้วัด (rubric 1–4 เทียบระดับที่คาดหวังตามวิทยฐานะ) + ผ่าน/ไม่ผ่านเกณฑ์ภาระงาน — เกณฑ์ผ่าน: **แต่ละคน ≥ 70%** (ไม่ใช่ค่าเฉลี่ย) ตาม ว9 หน้า 74
6. ระบบรวมคะแนน สร้าง**รายงาน PA** เป็นข้อมูลโครงสร้าง (JSON + อ้างอิงหลักฐาน) และดาวน์โหลด **PDF ฉบับร่าง/ตรวจสอบ** ได้ (แบบฟอร์มราชการ ก.ค.ศ. ฉบับ pixel-perfect อยู่ในแผนงานถัดไป)

กติกาที่ระบบบังคับในชั้นฐานข้อมูลเอง (ไม่ใช่แค่ในแอป): คะแนน rubric 1–4 เท่านั้น, กรรมการ 3 ที่นั่ง, ผู้รับการประเมินนั่งกรรมการตัวเองไม่ได้, audit log แก้/ลบไม่ได้ (append-only trigger), `passed_individual_threshold` เป็นคอลัมน์คำนวณ เขียนทับไม่ได้

## สถาปัตยกรรม

Node.js/TypeScript monorepo (npm workspaces) แบบ **contract-first** — ทุก endpoint กำหนดใน [docs/contracts/openapi.yaml](docs/contracts/openapi.yaml) ก่อน แล้ว generate types ห้ามเขียน DTO มือ

| ส่วน | เทคโนโลยี | หน้าที่ |
|---|---|---|
| `apps/api` | Fastify 5 + Zod | HTTP API — จุดบังคับสิทธิ์เพียงจุดเดียว (อ่าน matrix จาก [permissions.yaml](docs/contracts/permissions.yaml)) |
| `apps/web` | Vite 6 + React 18 | SPA สามบทบาท (ครู/ผอ./กรรมการ) — เรียก API ผ่าน generated types เท่านั้น |
| `apps/worker` | Node (polling loop) | สแกนไฟล์, สร้างรายงาน, ส่ง event จาก outbox, เก็บกวาด storage |
| `packages/*` | auth (argon2/JWT/refresh rotation) · database (Prisma repositories) · backend-shared (error codes/events จาก contracts) | |
| ฐานข้อมูล | **MySQL 8** ผ่าน Prisma (ADR-0008) — dev ใช้ MySQL ของ Laragon บนเครื่องโดยตรง | เก็บ metadata เท่านั้น |
| Object storage | **MinIO** (S3-compatible, ADR-0005) | เก็บไฟล์หลักฐานจริง (ข้อมูลส่วนบุคคล — ไม่เข้า git เด็ดขาด) |

## ข้อกำหนดก่อนติดตั้ง

- **Windows + [Laragon](https://laragon.org/)** ที่มี **MySQL 8.0.16 ขึ้นไป** (พัฒนา/ทดสอบบน 8.0.30) — หรือ MySQL 8 จากแหล่งอื่นก็ได้
- **Node.js 24** (CI ใช้เวอร์ชันนี้; 22+ ใช้งานได้)
- **Docker Desktop** — ใช้รัน MinIO เท่านั้น (ฐานข้อมูลไม่ต้องใช้ Docker แล้ว)

## ติดตั้ง (ครั้งแรก)

> คำสั่งทั้งหมดเป็น PowerShell — **ห้ามใช้ `&&`** (PowerShell 5.1 ไม่รองรับ) ใช้ `;` หรือรันทีละบรรทัด

```powershell
# 1) โค้ดและ dependencies
git clone <repo-url> aischool; cd aischool
npm install

# 2) เปิด Laragon ให้ MySQL ทำงาน แล้วสร้างฐานข้อมูล (ครั้งเดียว)
mysql -u root -e "CREATE DATABASE IF NOT EXISTS seip CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
# ถ้า mysql ไม่อยู่ใน PATH: ใช้ D:\laragon\bin\mysql\mysql-8.0.30-winx64\bin\mysql.exe

# 3) ตั้งค่า environment (ค่า default ใช้ได้ทันทีกับ Laragon: root ไม่มีรหัสผ่าน, พอร์ต 3011)
copy .env.example .env

# 4) สตาร์ท MinIO (object storage) — bucket ถูกสร้างอัตโนมัติ
docker compose up -d

# 5) สร้างตาราง + ข้อมูลเกณฑ์ประเมิน (ว9/ว10 ครบ 792 ระดับคำอธิบาย)
npm run db:generate; npm run db:migrate; npm run db:seed

# 6) build ทั้งระบบ
npm run build

# 7) สร้างผู้ใช้ตัวอย่าง (โรงเรียนสมมุติ + ครู + ผอ. + กรรมการ + รอบประเมินพร้อมใช้)
node --env-file=.env -e "import('./tests/e2e/global-setup.mjs').then(m=>m.default())"
```

### บัญชีผู้ใช้ตัวอย่าง (จากขั้นตอนที่ 7 — ใช้ได้เฉพาะเครื่อง dev)

| บทบาท | อีเมล | รหัสผ่าน |
|---|---|---|
| ครู | `e2e-teacher@seip.local` | `e2e-teacher-password-1234` |
| ผู้อำนวยการ (เห็นครบทุกเมนู) | `e2e-director@seip.local` | `e2e-director-password-1234` |
| กรรมการคนที่ 2 | `e2e-eval2@seip.local` | `e2e-eval2-password-1234` |
| กรรมการคนที่ 3 | `e2e-eval3@seip.local` | `e2e-eval3-password-1234` |

## รันระบบ (โหมดพัฒนา)

เปิด 2–3 terminal:

```powershell
# Terminal 1 — API (http://localhost:3011)
npm run dev:api

# Terminal 2 — Web (http://localhost:5173 — proxy /api ไปที่ :3011 ให้อัตโนมัติ)
npm run dev:web

# Terminal 3 (ตามต้องการ) — Worker: สแกนไฟล์อัปโหลด + สร้าง payload รายงาน
# ถ้าไม่รัน: อัปโหลดจะค้างสถานะ "รอสแกน" และรายงานที่สร้างใหม่จะค้าง draft
npm run dev:worker
```

เปิดเบราว์เซอร์ที่ **http://localhost:5173** แล้ว login ด้วยบัญชี ผอ. เพื่อเห็นภาพรวมทั้งหมด

ข้อควรรู้ตอนแก้โค้ด backend: `dev:api` / `dev:worker` เฝ้าดู `dist/` (ไฟล์ที่ compile แล้ว) ไม่ใช่ `src/` — หลังแก้ `.ts` ให้รัน `npm run build --workspace apps/api` (หรือ `npm run build`) ตัว watcher จะ restart ให้เอง ส่วนฝั่ง web มี HMR ปกติ

## การทดสอบ

ทุก suite ต้องมี MySQL (Laragon) + MinIO (docker) ทำงานอยู่ และผ่าน migrate + seed แล้ว

```powershell
npm run test:backend                                  # 19 — constraint ในฐานข้อมูล (CHECK/trigger/generated)
npm run test:unit                                     # auth 13 + web 29 + backend-shared
npm run test:integration --workspace apps/api         # 29 — flow จริงผ่าน HTTP + MySQL + MinIO
npm run test:integration --workspace apps/worker      # 9
npm run test:integration --workspace packages/database # 9
npm run test:security                                 # กวาด permission matrix ทุก operation × ทุกบทบาท

# e2e (Playwright) — ต้องมี API รันอยู่ที่ :3011 ก่อน (vite สตาร์ทให้เอง)
npx playwright install chromium                       # ครั้งแรกครั้งเดียว
$env:DATABASE_URL = "mysql://root@localhost:3306/seip"; npm run test:e2e   # 10 tests
```

Gates คุณภาพ (ชุดเดียวกับที่ CI รัน): `npm run gate:contracts` · `gate:ownership` · `gate:secret-scan` · `gate:dep-audit` · `typecheck` · `lint` — นิยามครบที่ [docs/qa/QUALITY-GATES.md](docs/qa/QUALITY-GATES.md)

## Staging / on-prem

ทั้ง stack (MySQL container + MinIO + api + worker + web) รันด้วย [docker-compose.staging.yml](docker-compose.staging.yml):

```powershell
copy .env.staging.example .env.staging   # แล้วใส่รหัสผ่านจริงทุกตัว
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
```

ขั้นตอน TLS (nginx), backup (`mysqldump --single-transaction --triggers`) และ restore อยู่ใน [docs/project/ops-runbook.md](docs/project/ops-runbook.md)

## โครงเอกสาร

| ที่ | เนื้อหา |
|---|---|
| [docs/project/PROJECT_STATE.md](docs/project/PROJECT_STATE.md) | สถานะปัจจุบัน + งานที่เหลือ |
| [docs/decisions/](docs/decisions/) | ADR-0001…0008 (stack, เกณฑ์ ว9/ว10, MinIO, single-agent, AI ภายในเครื่อง, MySQL) |
| [docs/contracts/](docs/contracts/) | openapi / permissions / events / error-codes — สัญญาที่ล็อกและบังคับด้วย CI |
| [docs/architecture/](docs/architecture/) | ขอบเขตโมดูล, กรอบเกณฑ์ประเมิน, data model, UX flows |
| [docs/qa/QUALITY-GATES.md](docs/qa/QUALITY-GATES.md) | นิยาม gate ทุกตัว + บันทึกการรันที่ผ่านแล้ว |

## ข้อจำกัดที่ควรรู้ (ตามสถานะปัจจุบัน)

- **Virus scanner เป็น stub** — โครงพร้อมแต่ยังไม่ต่อ ClamAV จริง ห้ามเปิดรับผู้ใช้จริงก่อนต่อ (ดู PROJECT_STATE)
- **PDF เป็นฉบับร่าง/ตรวจสอบ** — ไม่ใช่แบบฟอร์มราชการ ก.ค.ศ. อย่างเป็นทางการ (deferred โดยตั้งใจ, CCR-007)
- **การสร้างผู้ใช้จริงยังไม่มี UI** — ตอนนี้สร้างผ่าน fixture script เท่านั้น (งาน Sprint ถัดไป)
- ไฟล์หลักฐานมีข้อมูลส่วนบุคคล (PDPA) — `.env`, `uploads/`, `storage/` ถูก gitignore ไว้แล้ว **ห้าม commit เด็ดขาด**
