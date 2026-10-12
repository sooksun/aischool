# ADR-0011: Hosting, data residency, เส้นทางเครือข่าย และกติกาจัดหา GPU

## Status
**Proposed** (2026-10-12) — addendum เรื่อง GPU ต้องตัดสินภายใน 27 พ.ย. 2569. Supersedes ADR-0005 §2 (deploy on-premise ต่อโรงเรียน/เขต)

## Context
- ADR-0005 วางระบบ on-prem ที่โรงเรียน แต่แอปมือถือ (D4) ต้องมี backend ที่เข้าถึงได้จากอินเทอร์เน็ต และผู้ซื้อคือ สพท. (D2) ซึ่งดูแลหลายโรงเรียน
- D1: ระบบหลักและ AI ต้องอยู่ในประเทศไทย
- มาตรฐานความมั่นคงปลอดภัยระบบคลาวด์ของ สกมช. พ.ศ. 2567 มีผลตั้งแต่ 10 ก.ย. 2569. ระบบ impact สูงต้องมี DC หลักในไทย และผู้ให้บริการต้องมี ISO 27001 (**แหล่งข้อมูลทุติยภูมิ** เพราะ proxy บล็อกราชกิจจาฯ)
- AWS ap-southeast-7 (Bangkok) มีบริการที่ใช้ได้ (RDS, S3, Fargate, KMS) **แต่ไม่มี GPU**. GCP asia-southeast3 ก็ไม่มี GPU ที่ยืนยันได้
- AWS Direct Connect ให้บริการ ap-southeast-7 จาก Telehouse Bangkok และ TCC Bangkok (hosted port 200 Mbps $0.08/ชม., egress ผ่าน DX $0.041/GB — ตรวจ 2026-10-05) เส้นทาง AWS→GPU จึงอยู่ในไทยโดยโครงสร้าง

## Decision
1. SEIP เป็น **บริการที่ผู้ให้บริการดำเนินการเอง (operator-run) แบบ multi-tenant ระดับ สพท.**
2. **ระบบหลัก** อยู่ที่ AWS ap-southeast-7 (RDS PostgreSQL, S3, ECS Fargate, KMS)
3. **GPU node** ตั้งใน AWS Direct Connect location ที่ Bangkok (Telehouse Bangkok หรือ TCC Bangkok) เชื่อมผ่าน hosted DX private VIF และมี VPN สำรอง. Runner เป็นแบบ pull-only (ADR-0010)
4. **Backup site ที่สอง** อยู่ในไทย (restic, คีย์ DR ของผู้ให้บริการ) และมี **controller-exit export รายเดือนต่อ สพท.** เข้ารหัสด้วยคีย์ที่ สพท. ถือเอง
5. **Thai-owned profile** (PostgreSQL 18 + SeaweedFS + image ชุดเดียวกันบน NT, NIPA หรือ GDCC) ทดสอบใน CI ทุกสัปดาห์ และนำขึ้น production เมื่อ DPIA, ระดับ impact ของ สกมช. หรือ สพท. กำหนด (ลดความเสี่ยงที่ระบบหลักอยู่บน cloud ของบริษัทสหรัฐฯ)
6. **กติกาจัดหา GPU**:
   - pilot ใช้ **1 การ์ด** RTX PRO 6000 Blackwell Server Edition (96 GB ECC)
   - ทำ **pre-bake-off บน LANTA หรือ GPU เช่า ก่อนวันที่ 27 พ.ย. 2569**
   - **เช่า**ถ้าค่าเช่า ≤ 70,000 บาท/เดือนและเงื่อนไขผ่าน compliance; ถ้าไม่ผ่านจึงซื้อ
   - **การ์ดที่ 2** ซื้อเฉพาะหลังผ่าน gate ใน P5 และใช้สำหรับการขยายทั้งเขตในปีงบ 2571 เท่านั้น
   - TOR ใช้ spec แบบ generic (≥96 GB ECC, server edition, ไม่ระบุยี่ห้อ, ห้าม GeForce) และ**ห้ามแบ่งซื้อเพื่อเลี่ยงวงเงิน**
7. **การเข้าถึง production** ของเจ้าหน้าที่ผู้ให้บริการทำได้จากในประเทศไทยเท่านั้น และใช้ break-glass ที่ สพท. มองเห็น จำกัดเวลา ≤ 8 ชม. และบันทึกทุกครั้ง

## Options Considered
1. **AWS Bangkok + GPU ใน colocation ไทย (เลือก)** — ใช้บริการ managed ลดภาระคนดูแลคนเดียว และ GPU อยู่ในไทย
2. Appliance ที่ศูนย์ข้อมูล สพท./GDCC ทั้งชุด (k3s) — ได้อธิปไตยข้อมูลดีที่สุด แต่ภาระดูแลสูง และ judge ด้าน delivery ให้ 20/40. เก็บไว้เป็น Thai-owned profile
3. Supabase Singapore — ขัด D1
4. On-prem รายโรงเรียน (ADR-0005 เดิม) — แอปมือถือเข้าถึงไม่ได้ และโรงเรียนดูแล backup/GPU ไม่ไหว

## Consequences
- ค่าใช้จ่ายและรายละเอียดอยู่ใน `docs/architecture/design-brief-2026-10.md` §Cost
- ระบบหลักอยู่บนผู้ให้บริการสัญชาติสหรัฐฯ แม้ตั้งอยู่ในไทย (ความเสี่ยง CLOUD Act ในทางทฤษฎี) จึงต้องรักษา Thai-owned profile ให้ deploy ได้เสมอ
- push notification ผ่าน FCM/APNs ซึ่งอยู่นอกประเทศ payload จึงต้องไม่มีเนื้อหา และต้องให้ owner ยืนยันการตีความ D1 (PRD OQ-27/OQ-34)
- GPU 1 การ์ดว่างงานราว 97% ของปีที่ระดับ สพท. เดียว เพราะพีคตรงกันทั้งประเทศ (30 ก.ย.) จึงแชร์ระหว่างเขตไม่ช่วยลดพีค
- pilot ต้องอยู่ใต้วงเงิน ≤ 500,000 บาท (วิธีเฉพาะเจาะจงหรือ MOU) การขยายทั้งเขตต้องผ่าน e-bidding ในปีงบ 2571

## Approved By
รอ owner อนุมัติ

## Date
2026-10-12
