// Fixed text, not a forced checkbox — see evidence-submission-flow.md §PDPA notice
// for why: teachers submit often, and checkbox fatigue leads to un-read consent.
// Confirming "ยืนยันส่ง" is itself the acknowledgment; the server records which
// text version was shown (audit trail), not a client-side tick.
export function PdpaNotice() {
  return (
    <div className="alert alert-info" role="note">
      <span aria-hidden="true">🔒</span>
      <span>
        หลักฐานอาจมีข้อมูลส่วนบุคคลของผู้เรียน (ภาพ เสียง ชื่อ ผลงาน) ระบบเก็บไฟล์อย่างปลอดภัยและเข้าถึงได้เฉพาะผู้เกี่ยวข้องกับการประเมินของคุณ
        โปรดหลีกเลี่ยงข้อมูลอ่อนไหวที่ไม่จำเป็น เช่น เลขบัตรประชาชน ข้อมูลสุขภาพ
      </span>
    </div>
  );
}
