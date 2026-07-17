// S7 (done screen, revisited) + ongoing detail view — per evidence-submission-flow.md
// "S7 ส่งแล้ว: การ์ดสรุป + สถานะสแกน + ปุ่มผูกตัวชี้วัดเพิ่ม"
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import type { components } from '../api/schema.generated';

type EvidenceDetail = components['schemas']['Evidence'] & {
  files: components['schemas']['EvidenceFile'][];
  mappings: components['schemas']['Mapping'][];
};

export function EvidenceDetailPage() {
  const { evidenceId } = useParams<{ evidenceId: string }>();
  const [evidence, setEvidence] = useState<EvidenceDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!evidenceId) return;
    api.GET('/evidence/{evidenceId}', { params: { path: { evidenceId } } })
      .then((res) => setEvidence(unwrap(res) as EvidenceDetail))
      .catch(() => setError(true));
  }, [evidenceId]);

  if (error) {
    return (
      <main className="page">
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>ไม่พบหลักฐานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง</span>
        </div>
        <Link to="/" className="btn btn-secondary">กลับหน้าหลัก</Link>
      </main>
    );
  }

  if (!evidence) {
    return <main className="page" aria-busy="true" aria-live="polite"><p>กำลังโหลด…</p></main>;
  }

  return (
    <main className="page">
      <Link to="/" className="field-hint">← กลับ</Link>
      <h1>{evidence.title}</h1>
      {evidence.description && <p>{evidence.description}</p>}

      <h2>ไฟล์</h2>
      {evidence.files.length === 0 && <p className="field-hint">ยังไม่มีไฟล์</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {evidence.files.map((f) => (
          <li key={f.id} className="evidence-card">
            <div className="title">{f.original_filename}</div>
            <span className="status-badge">
              <span className="status-dot" data-state={f.scan_status} aria-hidden="true" />
              {scanStatusLabel(f.scan_status)}
            </span>
          </li>
        ))}
      </ul>

      <h2>ตัวชี้วัดที่ผูก</h2>
      {evidence.mappings.length === 0 && <p className="field-hint">ยังไม่ได้ผูกตัวชี้วัด</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {evidence.mappings.map((m) => (
          <li key={m.id} className="chip" style={{ display: 'inline-block', marginRight: 8, marginBottom: 8 }}>
            {mappingStatusLabel(m.status)}
          </li>
        ))}
      </ul>
    </main>
  );
}

function scanStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'กำลังตรวจสอบ';
    case 'clean': return 'ตรวจสอบแล้ว ปลอดภัย';
    case 'blocked': return 'ถูกกักไว้ — พบปัญหา';
    default: return status;
  }
}

function mappingStatusLabel(status: string): string {
  switch (status) {
    case 'suggested': return 'รอยืนยัน';
    case 'confirmed': return 'ยืนยันแล้ว';
    case 'rejected': return 'ถูกปฏิเสธ';
    case 'revoked': return 'ยกเลิกแล้ว';
    default: return status;
  }
}
