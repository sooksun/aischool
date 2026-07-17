/**
 * Thai product copy for report PDF affordances (cleanup L1).
 *
 * Contracts/CCR already state getReportPdf is structure-faithful SEIP layout,
 * not the pixel-perfect ก.ค.ศ. Protected Artifact plate (openapi x-deferred
 * official-paper-signature-fidelity). UI must not oversell "official form".
 */

/** List page intro under “รายงาน PA”. */
export const REPORT_LIST_FIDELITY_HINT =
  'รายงานเก็บเป็นข้อมูลโครงสร้าง (JSON) ตามแบบ PA1/PA2/PA3 — ดาวน์โหลด PDF ได้เมื่อจัดทำเสร็จ '
  + 'เป็นเอกสารร่างจากระบบสำหรับตรวจ/พิมพ์ ยังไม่ใช่แบบฟอร์มกระดาษ ก.ค.ศ. อย่างเป็นทางการ';

/** Primary download button label (not “official form”). */
export const REPORT_PDF_DOWNLOAD_LABEL = 'ดาวน์โหลด PDF ร่าง/ตรวจสอบ';

export const REPORT_PDF_DOWNLOAD_BUSY = 'กำลังสร้าง PDF…';

/** Short note next to the download control when PDF is ready. */
export const REPORT_PDF_FIDELITY_NOTE =
  'PDF นี้สร้างจากข้อมูลในระบบ (โครงสร้าง PA) — ใช้ตรวจความครบถ้วนก่อนพิมพ์ '
  + 'ไม่ใช่ต้นฉบับลายเซ็น/แบบฟอร์ม ก.ค.ศ. อย่างเป็นทางการ';

/** When payload still generating. */
export const REPORT_PDF_NOT_READY_HINT =
  'PDF พร้อมเมื่อจัดทำข้อมูลโครงสร้างเสร็จ (สถานะไม่ใช่ draft)';
