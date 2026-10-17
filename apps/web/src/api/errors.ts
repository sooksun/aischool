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
  'AUTH-004': 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
  // Deliberately vague: AUTH-005 covers unknown, expired AND already-used without
  // distinguishing them (CCR-014). Naming which case hit would rebuild in Thai
  // the oracle the API refuses to be.
  'AUTH-006': 'กรุณายืนยันตัวตนอีกครั้งก่อนทำรายการนี้',
  'AUTH-005': 'รหัสเชิญนี้ใช้ไม่ได้ อาจหมดอายุหรือถูกใช้ไปแล้ว กรุณาขอรหัสใหม่จากผู้ดูแลระบบ',
  // Same vagueness as AUTH-005, for the same reason (CCR-022).
  'AUTH-008': 'รหัสตั้งรหัสผ่านใหม่นี้ใช้ไม่ได้ อาจหมดอายุหรือถูกใช้ไปแล้ว กรุณาขอรหัสใหม่จากผู้ดูแลระบบ',
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
  'UPL-007': 'การอัปโหลดนี้สิ้นสุดแล้ว กรุณาเริ่มอัปโหลดใหม่',
  'UPL-008': 'ไฟล์ยังอัปโหลดไม่ครบ กรุณาลองใหม่',
  'MAP-001': 'หลักฐานนี้ถูกผูกกับตัวชี้วัดนี้ไปแล้ว',
  'MAP-002': 'ไม่สามารถทำรายการนี้ได้ในสถานะปัจจุบันของการผูกตัวชี้วัด',
  'MAP-003': 'ไม่สามารถผูกตัวชี้วัดนี้กับหลักฐานได้',
  'SCORE-001': 'คณะกรรมการยังไม่ครบ 3 คน — ยังให้คะแนนไม่ได้',
  'SCORE-002': 'รอบนี้ปิดแล้ว — แก้คะแนนไม่ได้',
  'SCORE-003': 'ระดับคะแนนต้องเป็น 1 ถึง 4 เท่านั้น',
  'SCORE-004': 'ต้องประกาศผลภาระงานก่อนส่งคะแนน (ประธานกรรมการ)',
  'SCORE-005': 'ต้องให้คะแนนตัวชี้วัดครบทุกข้อในครั้งเดียว',
  'CYCLE-001': 'เปลี่ยนสถานะรอบไม่ถูกต้อง',
  'CYCLE-002': 'มีรอบการประเมินซ้อนทับกันอยู่แล้ว',
  'CYCLE-003': 'ช่วงเวลารอบย่อยอยู่นอกรอบการประเมิน',
  'VAL-003': 'กรอบตัวชี้วัดไม่ตรงกับบทบาทผู้รับการประเมิน',
  'RPT-001': 'คำขอรายงานไม่ถูกต้อง (แบบฟอร์ม/รอบ/ผู้รับการประเมินไม่ตรงกัน)',
  'RPT-002': 'รายงานยังไม่พร้อมดาวน์โหลด PDF — รอระบบจัดทำข้อมูลให้เสร็จ',
  'EXP-001': 'ตรวจพบปัญหาที่ต้องแก้ก่อนส่งออก',
  'EXP-002': 'ไฟล์ส่งออกยังไม่พร้อม หรือหมดอายุแล้ว — สร้างใหม่ได้',
  'AI-002': 'เพิ่งวิเคราะห์หลักฐานนี้ไป กรุณารอ 10 นาทีแล้วลองใหม่',
  'AI-003': 'คำแนะนำนี้ถูกดำเนินการไปแล้ว',
  'AI-004': 'ตัวชี้วัดนี้ยังรับคำแนะนำแบบหลายรายการพร้อมกันไม่ได้',
  'RES-001': 'ไม่พบข้อมูลที่ต้องการ',
  'RES-002': 'ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาลองใหม่',
  'RES-004': 'ข้อมูลถูกแก้ไขจากที่อื่นแล้ว — โหลดหน้าใหม่แล้วลองอีกครั้ง',
  'RES-005': 'ข้อมูลถูกแก้ไขจากที่อื่นแล้ว — โหลดหน้าใหม่แล้วลองอีกครั้ง',
  'IDEMP-001': 'คำขอซ้ำไม่ตรงกับคำขอเดิม กรุณาลองใหม่',
  'RES-003': 'อีเมลนี้เป็นบุคลากรของโรงเรียนอยู่แล้ว',
  'SYS-001': 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่ภายหลัง',
  'SYS-002': 'ระบบไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่',
  'SYS-003': 'ฟังก์ชันนี้ยังไม่เปิดให้บริการ',
};

export function thaiMessageFor(error: ApiError): string {
  return THAI_MESSAGES[error.code] ?? `เกิดข้อผิดพลาด (${error.code})`;
}
