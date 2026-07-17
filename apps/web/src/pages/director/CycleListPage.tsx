// Director/school_admin landing for cycle management (SEIP-UI-002).
// Lists /cycles for the caller's school and creates new ones via /frameworks
// (picker, not a raw uuid — frameworks are a small listable set, unlike
// personnel: no listPersonnel endpoint exists yet, see CycleDetailPage's
// committee-form comment for that gap).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import type { components } from '../../api/schema.generated';

type Cycle = components['schemas']['Cycle'];
type Framework = components['schemas']['Framework'];

export function CycleListPage() {
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [error, setError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  function reload() {
    setCycles(null);
    api.GET('/cycles', {}).then((res) => setCycles(unwrap(res))).catch(() => setError(true));
  }

  useEffect(reload, []);

  return (
    <main className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>รอบการประเมิน</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'ยกเลิก' : '+ สร้างรอบใหม่'}
        </button>
      </div>

      {showCreate && (
        <CreateCycleForm onCreated={() => { setShowCreate(false); reload(); }} />
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>โหลดรายการรอบการประเมินไม่สำเร็จ กรุณาลองใหม่</span>
        </div>
      )}

      {cycles === null && !error && <p className="field-hint">กำลังโหลด…</p>}

      {cycles !== null && cycles.length === 0 && (
        <div className="empty-state">
          <p>ยังไม่มีรอบการประเมิน</p>
        </div>
      )}

      {cycles !== null && cycles.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {cycles.map((c) => (
            <li key={c.id}>
              <Link to={`/director/cycles/${c.id}`} className="evidence-card">
                <div className="title">{c.title}</div>
                <p className="field-hint">
                  ปีงบประมาณ {c.fiscal_year} · {kindLabel(c.evaluation_kind)} · {c.starts_on} – {c.ends_on}
                </p>
                <span className="status-badge">
                  <span className="status-dot" data-state={c.status === 'open' ? 'clean' : c.status === 'closed' ? 'blocked' : 'pending'} aria-hidden="true" />
                  {cycleStatusLabel(c.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function CreateCycleForm({ onCreated }: { onCreated: () => void }) {
  const [frameworks, setFrameworks] = useState<Framework[] | null>(null);
  const [frameworkVersionId, setFrameworkVersionId] = useState('');
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear() + 543); // พ.ศ.
  const [evaluationKind, setEvaluationKind] = useState<'pa' | 'dpa'>('pa');
  const [title, setTitle] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.GET('/frameworks', { params: { query: { status: 'active' } } })
      .then((res) => {
        const fws = unwrap(res);
        setFrameworks(fws);
        if (fws.length > 0) setFrameworkVersionId(fws[0].id);
      })
      .catch(() => setFrameworks([]));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    if (!frameworkVersionId) { setFieldError('กรุณาเลือกกรอบการประเมิน'); return; }
    if (!title.trim()) { setFieldError('กรุณาระบุชื่อรอบการประเมิน'); return; }
    if (!startsOn || !endsOn) { setFieldError('กรุณาระบุวันที่เริ่มและสิ้นสุด'); return; }
    if (startsOn > endsOn) { setFieldError('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด'); return; }

    setSubmitting(true);
    try {
      unwrap(await api.POST('/cycles', {
        body: {
          framework_version_id: frameworkVersionId, fiscal_year: fiscalYear,
          evaluation_kind: evaluationKind, title: title.trim(), starts_on: startsOn, ends_on: endsOn,
        },
      }));
      onCreated();
    } catch (err) {
      setFieldError(err instanceof ApiError ? thaiMessageFor(err) : 'สร้างรอบการประเมินไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
      <div className="field">
        <label htmlFor="framework">กรอบการประเมิน</label>
        {frameworks === null && <p className="field-hint">กำลังโหลด…</p>}
        {frameworks !== null && frameworks.length === 0 && <p className="field-hint">ไม่พบกรอบการประเมินที่ใช้งานได้</p>}
        {frameworks !== null && frameworks.length > 0 && (
          <select id="framework" value={frameworkVersionId} onChange={(e) => setFrameworkVersionId(e.target.value)}>
            {frameworks.map((f) => (
              <option key={f.id} value={f.id}>{f.code} — {f.legal_ref}</option>
            ))}
          </select>
        )}
      </div>

      <div className="field">
        <label htmlFor="kind">ประเภทการประเมิน</label>
        <select id="kind" value={evaluationKind} onChange={(e) => setEvaluationKind(e.target.value as 'pa' | 'dpa')}>
          <option value="pa">PA — การประเมินผลการปฏิบัติงานประจำปี</option>
          <option value="dpa">DPA — ขอมี/เลื่อนวิทยฐานะ</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="fiscal-year">ปีงบประมาณ (พ.ศ.)</label>
        <input id="fiscal-year" type="number" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} required />
      </div>

      <div className="field">
        <label htmlFor="cycle-title">ชื่อรอบการประเมิน</label>
        <input id="cycle-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </div>

      <div className="field">
        <label htmlFor="starts-on">วันที่เริ่ม</label>
        <input id="starts-on" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="ends-on">วันที่สิ้นสุด</label>
        <input id="ends-on" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required />
      </div>

      {fieldError && <div className="field-error" role="alert">{fieldError}</div>}

      <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
        {submitting ? 'กำลังสร้าง…' : 'สร้างรอบการประเมิน'}
      </button>
    </form>
  );
}

function kindLabel(kind: Cycle['evaluation_kind']): string {
  return kind === 'pa' ? 'PA' : 'DPA';
}

export function cycleStatusLabel(status: Cycle['status']): string {
  switch (status) {
    case 'planned': return 'วางแผน';
    case 'open': return 'เปิดใช้งาน';
    case 'closed': return 'ปิดแล้ว';
    default: return status;
  }
}
