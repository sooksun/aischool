// FR-117 (CCR-029): Thai labels for data-subject requests, shared by the person's
// page and the DPO's queue.
import type { components } from '../api/schema.generated';

export type SubjectRequest = components['schemas']['SubjectRequest'];
export type SubjectRequestType = components['schemas']['SubjectRequestType'];
export type SubjectRequestStatus = components['schemas']['SubjectRequestStatus'];

export const REQUEST_TYPE_TH: Record<SubjectRequestType, string> = {
  access: 'ขอเข้าถึง / ขอสำเนาข้อมูลของฉัน',
  portability: 'ขอรับข้อมูลในรูปแบบที่อ่านด้วยเครื่องได้',
  correction: 'ขอแก้ไขข้อมูลให้ถูกต้อง',
  erasure: 'ขอลบข้อมูล',
  restriction: 'ขอระงับการใช้ข้อมูล',
  objection: 'คัดค้านการประมวลผลข้อมูล',
};

export const REQUEST_STATUS_TH: Record<SubjectRequestStatus, string> = {
  received: 'รับคำขอแล้ว — รอเจ้าหน้าที่คุ้มครองข้อมูล (DPO) พิจารณา',
  fulfilling: 'อนุมัติแล้ว — กำลังจัดทำไฟล์ข้อมูล',
  approved: 'อนุมัติแล้ว — กำลังดำเนินการ',
  completed: 'เสร็จสิ้น',
  rejected: 'ไม่อนุมัติ',
};

export const thaiDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '');
