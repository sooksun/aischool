// Mirrors the Error schema in openapi.yaml. Every non-2xx response the client
// throws becomes one of these — components never see a raw fetch Response.
export class ApiError extends Error {
  readonly code: string;
  readonly details?: { field: string; issue: string }[];
  readonly requestId?: string;

  constructor(code: string, message: string, details?: { field: string; issue: string }[], requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

// error-codes.yaml -> Thai-facing messages (SEIP-UI-000 screen-states.md: "every
// error that comes from the API displays Thai text mapped from `code` — never the
// raw `message` from the server"). Only the codes this app's flows can actually
// hit are mapped; anything else falls back to a generic message with the code
// visible for support purposes.
const THAI_MESSAGES: Record<string, string> = {
  'AUTH-001': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'AUTH-002': 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  'AUTH-003': 'บัญชีนี้ถูกระงับการใช้งาน',
  'PERM-001': 'คุณไม่มีสิทธิ์ทำรายการนี้',
  'PERM-002': 'ไม่พบสิทธิ์การเข้าถึงโรงเรียนนี้',
  'PERM-003': 'คุณไม่ได้เป็นกรรมการของการประเมินนี้',
  'PERM-004': 'บทบาทนี้ดูข้อมูลได้อย่างเดียว ไม่สามารถแก้ไขได้',
  'VAL-001': 'ข้อมูลที่กรอกไม่ถูกต้อง',
  'VAL-002': 'ข้อมูลไม่ถูกต้องตามเงื่อนไข',
  'UPL-001': 'ชนิดไฟล์ไม่ตรงกับหมวดหลักฐานที่เลือก',
  'UPL-002': 'ไฟล์มีขนาดใหญ่เกินกำหนด',
  'UPL-003': 'วิดีโอมีความยาวเกินกำหนด (ไม่เกิน 10 นาที)',
  'UPL-004': 'ไฟล์นี้ถูกอัปโหลดสำเร็จไปแล้ว',
  'UPL-005': 'ไฟล์อาจเสียหายระหว่างอัปโหลด กรุณาลองใหม่',
  'UPL-006': 'ไฟล์นี้ถูกกักไว้เนื่องจากตรวจพบปัญหา',
  'MAP-001': 'หลักฐานนี้ถูกผูกกับตัวชี้วัดนี้ไปแล้ว',
  'MAP-002': 'ไม่สามารถทำรายการนี้ได้ในสถานะปัจจุบันของการผูกตัวชี้วัด',
  'MAP-003': 'ไม่สามารถผูกตัวชี้วัดนี้กับหลักฐานได้',
  'RPT-001': 'คำขอรายงานไม่ถูกต้อง (แบบฟอร์ม/รอบ/ผู้รับการประเมินไม่ตรงกัน)',
  'AI-001': 'ไม่สามารถแนะนำตัวชี้วัดได้ — ตรวจหลักฐานหรือกรอบตัวชี้วัด',
  'RES-001': 'ไม่พบข้อมูลที่ต้องการ',
  'RES-002': 'ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาลองใหม่',
  'SYS-001': 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่ภายหลัง',
  'SYS-002': 'ระบบไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่',
};

export function thaiMessageFor(error: ApiError): string {
  return THAI_MESSAGES[error.code] ?? `เกิดข้อผิดพลาด (${error.code})`;
}
