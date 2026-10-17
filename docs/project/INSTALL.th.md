# คู่มือติดตั้ง SEIP (เซิร์ฟเวอร์ของโรงเรียน / สพท.)

ติดตั้งระบบทั้งชุดด้วย Docker บนเครื่อง Linux หนึ่งเครื่อง — ฐานข้อมูล ที่เก็บไฟล์หลักฐาน
ตัวสแกนไวรัส ระบบสำรองข้อมูล API worker และหน้าเว็บ. ขั้นตอนเดียวกันนี้ CI ทดสอบจริงทุกครั้งที่ push
(gate **deploy smoke**): build image → เปิดระบบ → seed → สร้างผู้ดูแล → เชิญครู → อัปโหลด → สแกน → ดาวน์โหลดกลับ.

รายละเอียดเชิงปฏิบัติการ (TLS, rate limit, สำรอง/กู้คืน) อยู่ใน [`ops-runbook.md`](ops-runbook.md).

## 1. สิ่งที่ต้องมี

| | ขั้นต่ำ |
|---|---|
| เครื่อง | Linux x86-64, RAM 4 GB (ClamAV ใช้ ~1 GB), ดิสก์ 40 GB ขึ้นไป + ดิสก์แยกสำหรับสำรองข้อมูล |
| ซอฟต์แวร์ | Docker Engine 24+ พร้อม Compose v2, git, Node.js 20+ (ใช้รันสคริปต์ตรวจระบบเท่านั้น) |
| เครือข่าย | ออกอินเทอร์เน็ตได้ตอน build (ดาวน์โหลดแพ็กเกจ) และให้ ClamAV อัปเดตฐานไวรัส |
| ชื่อโดเมน + ใบรับรอง TLS | สำหรับใช้งานจริง (ทดลองครั้งแรกใช้ `http://127.0.0.1:8080` ได้) |

## 2. ตั้งค่า

```bash
git clone https://github.com/sooksun/aischool.git seip && cd seip
cp .env.staging.example .env.staging
```

แก้ `.env.staging` — **ทุกค่าที่ขึ้นต้นด้วย `CHANGE_ME` ต้องเปลี่ยน** (สร้างด้วย `openssl rand -hex 24`):

| ค่า | ใส่อะไร |
|---|---|
| `POSTGRES_PASSWORD`, `SEIP_MIGRATOR_PASSWORD`, `SEIP_APP_PASSWORD` | รหัสผ่านสุ่ม 3 ค่าที่ต่างกัน |
| `JWT_SECRET` | ค่าสุ่มยาว ≥ 32 ตัวอักษร |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | ค่าสุ่ม (secret ≥ 8 ตัวอักษร) |
| `SEIP_PUBLIC_ORIGIN` | **URL ที่ผู้ใช้พิมพ์เข้าเว็บ** เช่น `https://seip.school.ac.th` — ต้องตรงทุกตัวอักษร ไม่มี `/` ท้าย ถ้าผิด การอัปโหลดไฟล์จะล้มเหลวทั้งหมด. ทดลองในเครื่อง: `http://127.0.0.1:8080` |

ห้าม commit ไฟล์ `.env.staging` (อยู่ใน `.gitignore` แล้ว).

## 3. เปิดระบบ

```bash
C="docker compose -f docker-compose.staging.yml --env-file .env.staging"
$C up -d --build
$C ps          # migrate และ storage-init ต้อง "exited (0)"; ที่เหลือ running
```

ครั้งแรก build ราว 5–10 นาที. worker จะเริ่มหลัง ClamAV โหลดฐานไวรัสเสร็จ (~3 นาที).

## 4. ข้อมูลตั้งต้นและผู้ดูแลคนแรก (ทำครั้งเดียว)

```bash
# ตัวชี้วัด ว9/ว10 หมวดหลักฐาน วิทยฐานะ (รันซ้ำได้ ไม่ซ้ำซ้อน)
$C run --rm ops node prisma/seed.mjs

# โรงเรียน
$C run --rm ops node scripts/ops/provision-school.mjs --code=SCH-001 --name="โรงเรียนตัวอย่าง"

# ผู้ดูแลโรงเรียนคนแรก (รหัสผ่านส่งทาง env เท่านั้น ไม่ใส่ใน argument)
SEIP_ADMIN_PASSWORD='รหัสผ่านยาวอย่างน้อย12ตัว' \
  $C run --rm -e SEIP_ADMIN_PASSWORD ops node scripts/ops/bootstrap-admin.mjs \
  --email=admin@school.ac.th --name="ผู้ดูแลระบบ" --school=SCH-001
```

จากนั้นทุกอย่างทำในเว็บ: ผู้ดูแลเข้าเมนู **บุคลากร** เชิญครู (หรือนำเข้าจาก CSV) แล้วส่งรหัสเชิญให้แต่ละคน.

## 5. ตรวจว่าใช้งานได้จริง

```bash
SEIP_ADMIN_EMAIL=admin@school.ac.th SEIP_ADMIN_PASSWORD='…' \
  node scripts/ops/smoke-install.mjs --base="https://seip.school.ac.th"
```

ต้องจบด้วย `✓ … is installed and working`. สคริปต์จะเชิญครูทดสอบ 1 คนและสร้างหลักฐาน 1 รายการไว้ในโรงเรียนนั้น
— ใช้กับเครื่องทดสอบรับมอบ หรือสิ้นสุดสมาชิกภาพของครูทดสอบภายหลัง.

ถ้าไม่ผ่าน:

| ข้อความ | สาเหตุ |
|---|---|
| `upload URL points at http://seaweedfs:8333` หรือ `PUT … 403` | `SEIP_PUBLIC_ORIGIN` ไม่ตรงกับ URL ที่ใช้ — แก้แล้ว `$C up -d` |
| `api never answered` / 502 | `$C logs api` — มักเป็นรหัสผ่านฐานข้อมูลหรือ `JWT_SECRET` สั้นเกิน |
| `file never became downloadable` | worker ยังไม่เริ่ม (รอ ClamAV) — `$C logs worker clamav` |
| `no frameworks` | ยังไม่ได้รัน seed (ข้อ 4) |

## 6. เปิดให้ผู้ใช้เข้า (HTTPS)

ตัว `web` ฟังที่ `127.0.0.1:8080` เท่านั้น. เลือกอย่างใดอย่างหนึ่ง:

- **ง่ายที่สุด — Caddy ในชุด (ขอใบรับรองให้อัตโนมัติ):** ตั้ง DNS ของโดเมนชี้มาเครื่องนี้ เปิดพอร์ต 80/443
  แล้วเพิ่มใน `.env.staging`: `SEIP_DOMAIN=seip.school.ac.th` และ `SEIP_PUBLIC_ORIGIN=https://seip.school.ac.th`
  จากนั้น `$C --profile edge up -d` (ดู [`infra/caddy/Caddyfile`](../../infra/caddy/Caddyfile))
- **มี reverse proxy อยู่แล้ว:** ใช้ [`infra/nginx/seip-staging.conf.example`](../../infra/nginx/seip-staging.conf.example)
  (TLS, จำกัดอัตราการ login, security headers; ส่ง `/api/` และ `/seip-evidence/` ต่อให้ระบบ). ใบรับรองห้าม commit.

## 6b. ติดตั้ง/อัปเดตอัตโนมัติจาก GitHub ผ่าน SSH

workflow [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) ทำข้อ 2–6 ให้ทั้งหมดบนเซิร์ฟเวอร์
แล้วรัน smoke ผ่าน HTTPS จริง. รหัสผ่านของระบบ (ฐานข้อมูล, JWT, ที่เก็บไฟล์) **สร้างบนเซิร์ฟเวอร์** ใน
`/opt/seip/shared/.env.staging` และไม่ผ่าน GitHub.

1. บนเซิร์ฟเวอร์: ติดตั้ง Docker + Compose v2, สร้างผู้ใช้ deploy ในกลุ่ม `docker`, `sudo mkdir -p /opt/seip && sudo chown deploy /opt/seip`,
   ใส่ public key ของ deploy key ใน `~deploy/.ssh/authorized_keys`, ตั้ง DNS ของโดเมนชี้มาเครื่องนี้ และเปิดพอร์ต 80/443 (และพอร์ต SSH ให้ GitHub เข้าได้)
2. ใน GitHub: **Settings → Environments → New environment** ชื่อ `seip-production` แล้วใส่
   - Secrets: `SEIP_DEPLOY_HOST`, `SEIP_DEPLOY_USER`, `SEIP_DEPLOY_SSH_KEY` (private key), `SEIP_DEPLOY_KNOWN_HOSTS`
     (ผลของ `ssh-keyscan -t ed25519 <host>` ที่คุณตรวจแล้ว), `SEIP_ADMIN_PASSWORD`
   - Variables: `SEIP_DOMAIN`, `SEIP_ADMIN_EMAIL`, `SEIP_SCHOOL_CODE`, `SEIP_SCHOOL_NAME` (และถ้าต้องการ `SEIP_DEPLOY_PORT`, `SEIP_ACME_EMAIL`)
3. **Actions → deploy → Run workflow** (หรือ push tag `deploy-…`). ต้องจบด้วย `✓ https://… is installed and working`.

อัปเดตเวอร์ชันครั้งต่อไปก็รัน workflow เดิม — migration รันเอง, ข้อมูลและรหัสผ่านเดิมคงอยู่, เก็บ release ย้อนหลัง 3 ชุดใน `/opt/seip/releases`.

## 7. หลังติดตั้ง

- **สำรองข้อมูล**: service `backup` สำรองและทดลองกู้คืนทุกวันไปที่ `BACKUP_HOST_DIR` — ชี้ไปดิสก์อื่น และคัดลอกออกนอกเครื่อง (runbook §5).
- **อัปเดตเวอร์ชัน**: `git pull && $C up -d --build` (migration รันเองผ่าน service `migrate`).
- **ข้อมูลส่วนบุคคล (PDPA)**: ไฟล์หลักฐานอยู่ใน volume `seip_staging_seaweedfs` และฐานข้อมูลใน `seip_staging_pgdata` บนเครื่องนี้เท่านั้น.
