// Report detail — structured payload + section refs (SEIP-UI-004) + PDF download.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import { useAuth } from '../../hooks/useAuth';
import type { components } from '../../api/schema.generated';

type ReportDetail = components['schemas']['ReportDetail'];

export function ReportDetailPage() {
  const { schoolId } = useAuth();
  const { reportId } = useParams<{ reportId: string }>();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [error, setError] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!reportId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const res = await api.GET('/reports/{reportId}', {
          params: { path: { reportId: reportId! } },
        });
        if (cancelled) return;
        const data = unwrap(res) as ReportDetail;
        setReport(data);
        const gen = (data.payload as { generation_status?: string } | null)?.generation_status;
        if (data.status === 'draft' || gen === 'pending') {
          setPolling(true);
          timer = setTimeout(load, 2000);
        } else {
          setPolling(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reportId]);

  if (error) {
    return (
      <main className="page">
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>ไม่พบรายงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง</span>
        </div>
        <Link to="/reports" className="btn btn-secondary">กลับรายการรายงาน</Link>
      </main>
    );
  }

  if (!report) {
    return <main className="page" aria-busy="true"><p>กำลังโหลด…</p></main>;
  }

  const payload = report.payload as {
    generation_status?: string;
    subject?: { full_name?: string };
    confirmed_mappings?: unknown[];
    assignments?: unknown[];
  };

  const pdfReady = report.status !== 'draft' && payload.generation_status !== 'pending';
  const templateCode = report.template_code;

  async function downloadPdf() {
    if (!reportId) return;
    setPdfError(null);
    setPdfBusy(true);
    try {
      // Binary path — openapi-fetch types application/pdf as blob-ish; use raw fetch with same base.
      const token = sessionStorage.getItem('seip.access_token');
      const headers: Record<string, string> = {};
      if (token) headers.authorization = `Bearer ${token}`;
      if (schoolId) headers['x-school-id'] = schoolId;
      const res = await fetch(`/api/v1/reports/${reportId}/pdf`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { code?: string; message?: string };
        throw new ApiError(body.code ?? 'SYS-001', body.message ?? 'ดาวน์โหลด PDF ไม่สำเร็จ');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${templateCode}-${reportId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(err instanceof ApiError ? thaiMessageFor(err) : 'ดาวน์โหลด PDF ไม่สำเร็จ');
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <main className="page">
      <Link to="/reports" className="field-hint">← กลับรายการรายงาน</Link>
      <h1>{report.template_code}</h1>
      <p className="field-hint">
        สถานะ: {statusLabel(report.status)}
        {polling && ' · กำลังจัดทำ payload…'}
      </p>

      <div style={{ margin: '12px 0' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!pdfReady || pdfBusy}
          onClick={() => void downloadPdf()}
        >
          {pdfBusy ? 'กำลังสร้าง PDF…' : 'ดาวน์โหลด PDF แบบฟอร์ม PA'}
        </button>
        {!pdfReady && (
          <p className="field-hint">PDF พร้อมเมื่อจัดทำ payload เสร็จ (ไม่ใช่สถานะ draft)</p>
        )}
        {pdfError && (
          <div className="alert alert-error" role="alert">{pdfError}</div>
        )}
      </div>

      {report.status === 'draft' && (
        <div className="alert" role="status">
          ระบบกำลังจัดทำรายงานจากคะแนนและการผูกหลักฐานที่ยืนยันแล้ว — หน้านี้จะอัปเดตอัตโนมัติ
        </div>
      )}

      {payload.subject?.full_name && (
        <p><strong>ผู้รับการประเมิน:</strong> {payload.subject.full_name}</p>
      )}

      <h2>การอ้างอิงหลักฐาน (section refs)</h2>
      {report.section_refs.length === 0 && (
        <p className="field-hint">
          {report.status === 'draft'
            ? 'ยังไม่มี — รอ worker จัดทำ'
            : 'ไม่มี mapping ที่ยืนยันแล้วสำหรับรอบนี้'}
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {report.section_refs.map((s) => (
          <li key={s.id} className="chip" style={{ display: 'block', marginBottom: 8 }}>
            {s.section_key}
            {s.evidence_id && (
              <>
                {' · '}
                <Link to={`/evidence/${s.evidence_id}`}>หลักฐาน</Link>
              </>
            )}
          </li>
        ))}
      </ul>

      <h2>ข้อมูลโครงสร้าง (payload)</h2>
      <pre
        style={{
          background: 'var(--surface-2, #f4f4f5)',
          padding: 12,
          borderRadius: 8,
          overflow: 'auto',
          fontSize: 12,
          maxHeight: 420,
        }}
      >
        {JSON.stringify(report.payload, null, 2)}
      </pre>
    </main>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'draft': return 'กำลังจัดทำ';
    case 'pending_approval': return 'รออนุมัติ';
    case 'approved': return 'อนุมัติแล้ว';
    case 'issued': return 'ออกแล้ว';
    case 'superseded': return 'ถูกแทนที่';
    default: return status;
  }
}
