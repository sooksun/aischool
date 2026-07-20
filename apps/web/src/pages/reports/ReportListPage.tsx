// Reports list + create (SEIP-UI-004). PDF is draft/review layout — not official plate (L1).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import type { components } from '../../api/schema.generated';
import { useAuth } from '../../hooks/useAuth';
import { REPORT_LIST_FIDELITY_HINT } from '../../lib/reportPdfCopy';
import { usePersonnel } from '../../lib/usePersonnel';

type Report = components['schemas']['Report'];
type Cycle = components['schemas']['Cycle'];
type TemplateCode = components['schemas']['ReportTemplateCode'];

const TEMPLATES: { code: TemplateCode; label: string }[] = [
  { code: 'PA1_s', label: 'PA1 /ส — ข้อตกลง (ครู)' },
  { code: 'PA1_bs', label: 'PA1 /บส — ข้อตกลง (ผู้บริหาร)' },
  { code: 'PA2_s', label: 'PA2 /ส — แบบประเมิน (ครู)' },
  { code: 'PA2_bs', label: 'PA2 /บส — แบบประเมิน (ผู้บริหาร)' },
  { code: 'PA3_s', label: 'PA3 /ส — สรุปผล (ครู)' },
  { code: 'PA3_bs', label: 'PA3 /บส — สรุปผล (ผู้บริหาร)' },
];

export function ReportListPage() {
  const { capabilities } = useAuth();
  const canCreate = capabilities.createReports;
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  function reload() {
    setReports(null);
    api.GET('/reports', {})
      .then((res) => {
        const page = unwrap(res);
        setReports(page.items);
      })
      .catch(() => setError(true));
  }

  useEffect(reload, []);

  return (
    <main className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>รายงาน PA</h1>
        {canCreate && (
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'ยกเลิก' : '+ สร้างรายงาน'}
          </button>
        )}
      </div>

      <p className="field-hint" role="note">
        {REPORT_LIST_FIDELITY_HINT}
      </p>

      {showCreate && canCreate && (
        <CreateReportForm onCreated={() => { setShowCreate(false); reload(); }} />
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>โหลดรายการรายงานไม่สำเร็จ</span>
        </div>
      )}

      {reports === null && !error && <p className="field-hint">กำลังโหลด…</p>}

      {reports !== null && reports.length === 0 && (
        <div className="empty-state">
          <p>ยังไม่มีรายงาน</p>
        </div>
      )}

      {reports !== null && reports.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {reports.map((r) => (
            <li key={r.id}>
              <Link to={`/reports/${r.id}`} className="evidence-card">
                <div className="title">{templateLabel(r.template_code)}</div>
                <p className="field-hint">
                  สร้างเมื่อ {new Date(r.generated_at).toLocaleString('th-TH')}
                </p>
                <span className="status-badge">
                  <span
                    className="status-dot"
                    data-state={statusDot(r.status)}
                    aria-hidden="true"
                  />
                  {statusLabel(r.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function CreateReportForm({ onCreated }: { onCreated: () => void }) {
  const { personnel, failed: personnelFailed } = usePersonnel();
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [cycleId, setCycleId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [template, setTemplate] = useState<TemplateCode>('PA2_s');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    api.GET('/cycles', {})
      .then((res) => setCycles(unwrap(res)))
      .catch(() => setCycles([]));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await unwrap(await api.POST('/reports', {
        body: {
          cycle_id: cycleId,
          subject_personnel_id: subjectId,
          template_code: template,
        },
      }));
      onCreated();
    } catch (err) {
      setFormError(err instanceof ApiError ? thaiMessageFor(err) : 'สร้างรายงานไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="evidence-card" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>สร้างรายงานใหม่</h2>
      {formError && (
        <div className="alert alert-error" role="alert">{formError}</div>
      )}
      <label className="field">
        <span>รอบการประเมิน (cycle)</span>
        <select
          required
          value={cycleId}
          onChange={(e) => setCycleId(e.target.value)}
          disabled={!cycles}
        >
          <option value="">— เลือก —</option>
          {(cycles ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} (ปี {c.fiscal_year})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>ผู้รับการประเมิน</span>
        {personnel === null && !personnelFailed && <span className="field-hint">กำลังโหลดรายชื่อ…</span>}
        {personnel !== null && (
          <select required value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">— เลือก —</option>
            {personnel.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}{p.employee_code ? ` (${p.employee_code})` : ''}
              </option>
            ))}
          </select>
        )}
        {/* Degraded, not broken — and note the old `pattern="[0-9a-fA-F-]{36}"`
            here accepted 36 consecutive dashes. The picker removes the need to
            hand-validate a UUID at all. */}
        {personnelFailed && (
          <input
            required
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value.trim())}
            placeholder="personnel profile uuid"
          />
        )}
      </label>
      <label className="field">
        <span>แบบฟอร์ม</span>
        <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateCode)}>
          {TEMPLATES.map((t) => (
            <option key={t.code} value={t.code}>{t.label}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-primary" disabled={submitting || !cycleId || !subjectId}>
        {submitting ? 'กำลังสร้าง…' : 'สร้างและจัดทำรายงาน'}
      </button>
    </form>
  );
}

function templateLabel(code: string): string {
  return TEMPLATES.find((t) => t.code === code)?.label ?? code;
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

function statusDot(status: string): string {
  if (status === 'draft') return 'pending';
  if (status === 'issued' || status === 'approved') return 'clean';
  if (status === 'superseded') return 'blocked';
  return 'pending';
}
