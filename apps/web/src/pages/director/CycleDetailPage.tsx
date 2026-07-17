// Cycle detail + inline round management (SEIP-UI-002). Rounds are shown here
// rather than at their own route: openapi.yaml has no GET /rounds/{roundId} —
// round data only ever arrives embedded in CycleDetail.rounds[], so a
// standalone /rounds/:id route couldn't survive a page refresh. Assignment
// management (which DOES have its own real GET) gets its own route instead.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import { cycleStatusLabel } from './CycleListPage';
import type { components } from '../../api/schema.generated';

type CycleDetail = components['schemas']['CycleDetail'];
type Round = components['schemas']['Round'];
type CycleStatus = components['schemas']['CycleStatus'];
type RoundStatus = components['schemas']['RoundStatus'];

// planned -> open -> scoring -> closed, one step at a time (server: CYCLE-001).
const ROUND_TRANSITIONS: Record<RoundStatus, { next: RoundStatus; label: string } | null> = {
  planned: { next: 'open', label: 'เปิดรอบ' },
  open: { next: 'scoring', label: 'เข้าสู่ช่วงให้คะแนน' },
  scoring: { next: 'closed', label: 'ปิดรอบ' },
  closed: null,
};

export function CycleDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const navigate = useNavigate();
  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [error, setError] = useState(false);
  const [showCreateRound, setShowCreateRound] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function reload() {
    if (!cycleId) return;
    api.GET('/cycles/{cycleId}', { params: { path: { cycleId } } })
      .then((res) => setCycle(unwrap(res)))
      .catch(() => setError(true));
  }

  useEffect(reload, [cycleId]);

  async function updateCycleStatus(status: CycleStatus) {
    if (!cycleId) return;
    setActionError(null);
    try {
      unwrap(await api.PATCH('/cycles/{cycleId}', { params: { path: { cycleId } }, body: { status } }));
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? thaiMessageFor(err) : 'อัปเดตสถานะไม่สำเร็จ');
    }
  }

  async function transitionRound(round: Round) {
    const transition = ROUND_TRANSITIONS[round.status];
    if (!transition) return;
    setActionError(null);
    try {
      unwrap(await api.PATCH('/rounds/{roundId}', { params: { path: { roundId: round.id } }, body: { status: transition.next } }));
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? thaiMessageFor(err) : 'เปลี่ยนสถานะรอบไม่สำเร็จ');
    }
  }

  if (error) {
    return (
      <main className="page">
        <div className="alert alert-error" role="alert"><span aria-hidden="true">⚠</span><span>ไม่พบรอบการประเมินนี้</span></div>
        <Link to="/director/cycles" className="btn btn-secondary">กลับ</Link>
      </main>
    );
  }
  if (cycle === null) return <main className="page"><p className="field-hint">กำลังโหลด…</p></main>;

  return (
    <main className="page">
      <Link to="/director/cycles" className="field-hint">← รอบการประเมินทั้งหมด</Link>
      <h1>{cycle.title}</h1>
      <p className="field-hint">ปีงบประมาณ {cycle.fiscal_year} · {cycle.starts_on} – {cycle.ends_on}</p>

      <div className="field">
        <span className="status-badge">
          <span className="status-dot" data-state={cycle.status === 'open' ? 'clean' : cycle.status === 'closed' ? 'blocked' : 'pending'} aria-hidden="true" />
          {cycleStatusLabel(cycle.status)}
        </span>
        {cycle.status === 'planned' && (
          <button type="button" className="btn btn-secondary" style={{ marginLeft: 'var(--space-2)' }} onClick={() => updateCycleStatus('open')}>เปิดใช้งานรอบการประเมิน</button>
        )}
        {cycle.status === 'open' && (
          <button type="button" className="btn btn-secondary" style={{ marginLeft: 'var(--space-2)' }} onClick={() => updateCycleStatus('closed')}>ปิดรอบการประเมิน</button>
        )}
      </div>

      {actionError && <div className="field-error" role="alert">{actionError}</div>}

      <h2>รอบย่อย (Rounds)</h2>
      {cycle.rounds.length === 0 && <p className="field-hint">ยังไม่มีรอบย่อย</p>}
      {cycle.rounds.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {cycle.rounds.map((r) => {
            const transition = ROUND_TRANSITIONS[r.status];
            return (
              <li key={r.id} className="evidence-card" style={{ marginBottom: 'var(--space-2)' }}>
                <div className="title">รอบที่ {r.round_number} — {r.purpose}</div>
                <p className="field-hint">{r.period_start} – {r.period_end}</p>
                <span className="status-badge">
                  <span className="status-dot" data-state={r.status === 'closed' ? 'blocked' : r.status === 'planned' ? 'pending' : 'clean'} aria-hidden="true" />
                  {roundStatusLabel(r.status)}
                </span>
                <div className="action-bar" style={{ position: 'static', border: 'none', padding: 'var(--space-2) 0 0', background: 'none' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => navigate(`/director/rounds/${r.id}/assignments`, { state: { round: r } })}>
                    จัดการกรรมการและมอบหมาย
                  </button>
                  {transition && (
                    <button type="button" className="btn btn-primary" onClick={() => transitionRound(r)}>{transition.label}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="btn btn-secondary" onClick={() => setShowCreateRound((v) => !v)}>
        {showCreateRound ? 'ยกเลิก' : '+ เพิ่มรอบย่อย'}
      </button>
      {showCreateRound && cycleId && (
        <CreateRoundForm
          cycleId={cycleId}
          cycleStarts={cycle.starts_on}
          cycleEnds={cycle.ends_on}
          nextRoundNumber={cycle.rounds.length + 1}
          onCreated={() => { setShowCreateRound(false); reload(); }}
        />
      )}
    </main>
  );
}

function CreateRoundForm({ cycleId, cycleStarts, cycleEnds, nextRoundNumber, onCreated }: {
  cycleId: string; cycleStarts: string; cycleEnds: string; nextRoundNumber: number; onCreated: () => void;
}) {
  const [roundNumber, setRoundNumber] = useState(nextRoundNumber);
  const [purpose, setPurpose] = useState('');
  const [periodStart, setPeriodStart] = useState(cycleStarts);
  const [periodEnd, setPeriodEnd] = useState(cycleEnds);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    if (!purpose.trim()) { setFieldError('กรุณาระบุวัตถุประสงค์ของรอบ'); return; }
    if (periodStart > periodEnd) { setFieldError('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด'); return; }

    setSubmitting(true);
    try {
      unwrap(await api.POST('/cycles/{cycleId}/rounds', {
        params: { path: { cycleId } },
        body: { round_number: roundNumber, purpose: purpose.trim(), period_start: periodStart, period_end: periodEnd },
      }));
      onCreated();
    } catch (err) {
      setFieldError(err instanceof ApiError ? thaiMessageFor(err) : 'สร้างรอบย่อยไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
      <div className="field">
        <label htmlFor="round-number">รอบที่</label>
        <input id="round-number" type="number" min={1} value={roundNumber} onChange={(e) => setRoundNumber(Number(e.target.value))} required />
      </div>
      <div className="field">
        <label htmlFor="purpose">วัตถุประสงค์</label>
        <input id="purpose" type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="เช่น การประเมินประจำปี, เลื่อนขั้นเงินเดือนครั้งที่ 1" maxLength={100} required />
      </div>
      <div className="field">
        <label htmlFor="period-start">วันที่เริ่ม</label>
        <input id="period-start" type="date" value={periodStart} min={cycleStarts} max={cycleEnds} onChange={(e) => setPeriodStart(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="period-end">วันที่สิ้นสุด</label>
        <input id="period-end" type="date" value={periodEnd} min={cycleStarts} max={cycleEnds} onChange={(e) => setPeriodEnd(e.target.value)} required />
      </div>
      <p className="field-hint">ต้องอยู่ในช่วงของรอบการประเมิน ({cycleStarts} – {cycleEnds})</p>

      {fieldError && <div className="field-error" role="alert">{fieldError}</div>}

      <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
        {submitting ? 'กำลังสร้าง…' : 'เพิ่มรอบย่อย'}
      </button>
    </form>
  );
}

function roundStatusLabel(status: RoundStatus): string {
  switch (status) {
    case 'planned': return 'วางแผน';
    case 'open': return 'เปิดรับข้อมูล';
    case 'scoring': return 'กำลังให้คะแนน';
    case 'closed': return 'ปิดแล้ว';
    default: return status;
  }
}
