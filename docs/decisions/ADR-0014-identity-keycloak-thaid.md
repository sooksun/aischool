# ADR-0014: Identity — Keycloak เป็นตัวกลาง ThaID, person key, BFF และ step-up MFA

## Status
**Accepted** (2026-10-12, owner อนุมัติ; เสนอ 2026-10-12) — เสนอใน P0 และรับรองเมื่อออกจาก P1. Supersedes หัวข้อ auth ใน ADR-0006 (การออก token เองด้วย Argon2id + JWT + refresh rotation)

## Context
- แอปมือถือต้องใช้ OIDC + PKCE ผ่าน system browser. Token ที่ระบบออกเองเหมาะกับเว็บ แต่จัดการ device session และ offline session ของมือถือได้ไม่ดี
- portfolio เป็นของบุคคลและต้องติดตัวไปเมื่อย้ายโรงเรียน (D2) จึงต้องมี key ประจำตัวบุคคลที่คงที่ข้ามโรงเรียน
- ThaID (กรมการปกครอง) เป็น OIDC ระดับประเทศ แต่เงื่อนไขและค่าธรรมเนียมสำหรับ relying party **ยังไม่ได้ยืนยัน**
- เครื่องในโรงเรียนมักใช้ร่วมกัน

## Decision
1. **Keycloak 26.x** เป็น authorization server ตัวเดียว: realm `seip` และ **หนึ่ง Organization ต่อ สพท.** ตอนนี้ pin 26.7.5 แล้วขึ้น 26.8.x ใน P1 หลังผ่านช่วงทดสอบ
2. **ThaID** เชื่อมเป็น brokered IdP แบบ confidential client ขอ scope เท่าที่จำเป็น
3. **Person key** = KMS HMAC ของเลขประจำตัวประชาชน. pid ดิบเก็บแบบเข้ารหัส และลบออกจาก Keycloak หลัง link แล้ว
4. **เว็บ**: Fastify BFF ใช้ cookie `__Host-seip` แบบ httpOnly. Session หมดอายุเมื่อไม่ใช้งาน 30 นาที และสูงสุด 8 ชั่วโมง. ใช้ double-submit CSRF
5. **Flutter**: PKCE ผ่าน system browser (flutter_appauth), refresh token แบบหมุน และ offline session แยกต่ออุปกรณ์. ยกเลิกอุปกรณ์แล้วต้องมีผลภายใน ≤ 60 วินาที
6. **Step-up MFA (LoA2: ThaID, passkey หรือ TOTP)** บังคับสำหรับ ผอ., กรรมการ, ผู้ดูแลระบบโรงเรียน/เขต, DPO และ operator
7. **Authorization อยู่ที่ SEIP** (role-resolution, grants, `permissions.yaml`) ไม่อยู่ใน Keycloak
8. **ทางสำรอง**: activation code คู่กับ passkey/TOTP และ device-code/QR เมื่อ ThaID app-switch กลับมาที่ browser ไม่ได้
9. เลิกออก token เองหลังจบ P1

## Options Considered
1. **Keycloak + ThaID (เลือก)** — มาตรฐาน OIDC เต็มรูปแบบ, self-host ในไทยได้ และรองรับ passkey/TOTP
2. ใช้ JWT ที่ออกเองต่อไป — ต้องเขียน PKCE, device session และ MFA เอง
3. LINE Login — ไม่ใช่ตัวตนทางราชการ และไม่ควรเป็น person key

## Consequences
- เพิ่มบริการ JVM ที่ต้องดูแลอีก 1 ตัว
- สพท. ต้องยื่นขอเป็น ThaID relying party ตั้งแต่ P0. ระหว่างรอใช้ dev OIDC IdP
- การจัดเก็บเลขประจำตัวประชาชนต้องอยู่ใน DPIA

## Approved By
owner (sooksun) — 2026-10-12

## Date
2026-10-12
