// Report detail — structured ReportPayload + section refs (SEIP-UI-004) + PDF download.
// Cleanup M2: payload typed via OpenAPI ReportPayload (schema_version=1).
// Cleanup L1: PDF UX = draft/review fidelity, not official ก.ค.ศ. plate.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, unwrap, downloadAuthorized } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import { useAuth } from '../../hooks/useAuth';
import type { components } from '../../api/schema.generated';
import {
  REPORT_PDF_DOWNLOAD_BUSY,
  REPORT_PDF_DOWNLOAD_LABEL,
  REPORT_PDF_FIDELITY_NOTE,
  REPORT_PDF_NOT_READY_HINT,
} from '../../lib/reportPdfCopy';

type ReportDetail = components['schemas']['ReportDetail'];
type ReportPayload = components['schemas']['ReportPayload'];

function isPayloadReady(p: ReportPayload): boolean {
  return p.generation_status === 'ready';
}

export function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  // createReports is the closest existing flag: permissions.yaml grants
  // approveReport/returnReport to exactly the roles it covers (director,
  // school_admin), so a separate capability would be the same set under a second
  // name. The API remains the gate — the route rule that you may not decide on
  // your OWN report is not expressible here at all.
  const { capabilities } = useAuth();
  const canDecide = capabilities.createReports;
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [error, setError] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  // Bumped after a decision to re-run the load effect. A counter rather than a
  // callback ref because the effect already owns cancellation and the polling
  // timer — re-entering it is simpler than duplicating that teardown.
  const [reloadKey, setReloadKey] = useState(0);

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
        const gen = data.payload.generation_status;
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
  }, [reportId, reloadKey]);

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

  const payload = report.payload;
  const pdfReady = report.status !== 'draft' && isPayloadReady(payload);
  const templateCode = report.template_code;
  const subjectName = isPayloadReady(payload) ? payload.subject?.full_name : undefined;

  async function downloadPdf() {
    if (!reportId) return;
    setPdfError(null);
    setPdfBusy(true);
    try {
      // Same in-memory auth as openapi-fetch (cleanup B3) — no sessionStorage token reads.
      await downloadAuthorized(
        `/reports/${reportId}/pdf`,
        `${templateCode}-${reportId.slice(0, 8)}.pdf`,
      );
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

      <ApprovalPanel
        report={report}
        canDecide={canDecide}
        onDecided={() => setReloadKey((k) => k + 1)}
      />

      <div style={{ margin: '12px 0' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!pdfReady || pdfBusy}
          onClick={() => void downloadPdf()}
        >
          {pdfBusy ? REPORT_PDF_DOWNLOAD_BUSY : REPORT_PDF_DOWNLOAD_LABEL}
        </button>
        {pdfReady ? (
          <p className="field-hint" role="note">{REPORT_PDF_FIDELITY_NOTE}</p>
        ) : (
          <p className="field-hint">{REPORT_PDF_NOT_READY_HINT}</p>
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

      {subjectName && (
        <p><strong>ผู้รับการประเมิน:</strong> {subjectName}</p>
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
      {/* Still a raw dump — the 2026-07-19 audit flagged this as a developer view
          shipped as the report's primary content. Rendering the payload properly
          is real work and belongs with the PA report layout task, not smuggled
          into an approval CCR; left visible and labelled rather than quietly
          removed. */}
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

/**
 * Approval state, the decision trail, and the approve/return actions (CCR-016).
 *
 * Before this, a generated report reached `pending_approval` and stopped there
 * forever — the document existed but nobody could sign it. The panel is shown to
 * everyone who can read the report, not only to those who can decide: the subject
 * of a PA report has a direct interest in knowing whether it has been endorsed
 * and by whom.
 */
function ApprovalPanel({ report, canDecide, onDecided }: {
  report: ReportDetail;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'return'>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);

  const approvals = report.approvals ?? [];
  const awaiting = report.status === 'pending_approval';

  function decide(kind: 'approve' | 'return') {
    setError(null);
    if (kind === 'return' && !comment.trim()) {
      return setError('ระบุเหตุผลที่ส่งกลับ เพื่อให้ผู้จัดทำทราบว่าต้องแก้ไขอะไร');
    }
    setBusy(kind);
    const req = kind === 'approve'
      ? api.POST('/reports/{reportId}/approve', {
          params: { path: { reportId: report.id } },
          body: { comment: comment.trim() || null },
        })
      : api.POST('/reports/{reportId}/return', {
          params: { path: { reportId: report.id } },
          body: { comment: comment.trim() },
        });

    req
      .then((res) => { unwrap(res); setComment(''); setReturning(false); onDecided(); })
      .catch((e) => setError(e instanceof ApiError ? thaiMessageFor(e) : 'บันทึกผลการพิจารณาไม่สำเร็จ'))
      .finally(() => setBusy(null));
  }

  return (
    <section
      aria-labelledby="approval-heading"
      style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 16, margin: '12px 0' }}
    >
      <h2 id="approval-heading" style={{ marginTop: 0 }}>การอนุมัติ</h2>

      {report.status === 'approved' ? (
        <div className="alert alert-success" role="status">
          <span>รายงานนี้ผ่านการอนุมัติแล้ว</span>
        </div>
      ) : (
        <div className="alert alert-info" role="note">
          <span aria-hidden="true">ℹ</span>
          <span>
            {awaiting
              ? 'รอการพิจารณาจากผู้อำนวยการ — เอกสารนี้ยังไม่มีผลรับรอง'
              : 'ยังไม่เข้าสู่ขั้นตอนอนุมัติ (รายงานต้องจัดทำเสร็จก่อน)'}
          </span>
        </div>
      )}

      {approvals.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
          {approvals.map((a) => (
            <li key={a.id} className="field-hint" style={{ marginBottom: 6 }}>
              {a.decision === 'approved' ? '✓ อนุมัติ' : '↩ ส่งกลับให้แก้ไข'}
              {a.decided_at && ` · ${new Date(a.decided_at).toLocaleString('th-TH')}`}
              {a.comment && (
                <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{a.comment}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canDecide && awaiting && (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="approval-comment">
              ความเห็น{returning ? '' : ' (ไม่บังคับ)'}
            </label>
            <textarea
              id="approval-comment" rows={3} maxLength={2000}
              value={comment} onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {error && <div className="field-error" role="alert">{error}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" className="btn btn-primary"
              onClick={() => decide('approve')} disabled={busy !== null}
            >
              {busy === 'approve' ? 'กำลังบันทึก…' : 'อนุมัติ'}
            </button>
            <button
              type="button" className="btn btn-secondary"
              onClick={() => { setReturning(true); decide('return'); }}
              disabled={busy !== null}
            >
              {busy === 'return' ? 'กำลังบันทึก…' : 'ส่งกลับให้แก้ไข'}
            </button>
          </div>
          {/* The round rule is a server decision (RPT-003) and the UI cannot know
              the round's status from this response, so it is explained up front
              rather than surfaced only as a rejection. */}
          <p className="field-hint" style={{ marginTop: 8 }}>
            อนุมัติได้เมื่อปิดรอบการประเมินแล้วเท่านั้น เพราะคะแนนยังแก้ไขได้จนกว่ารอบจะปิด
          </p>
        </div>
      )}
    </section>
  );
}
