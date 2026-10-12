// Committee assignment management for one round (SEIP-UI-002).
//
// CCR-014 resolved half of the limitation this file used to carry: listPersonnel
// now exists, so the evaluatee is a name picker instead of a raw-uuid text box.
//
// REMAINING LIMITATION (documented, not hidden): the 3 committee seats are keyed
// on evaluator_user_id — a UserAccount id, not a personnel id — and listPersonnel
// returns neither. The operation that does map users to names is listMembers,
// which permissions.yaml grants to school_admin only, while this page is gated on
// manageCycles (director + school_admin). Widening listMembers to director would
// be a permissions change beyond what CCR-014 was approved for, so committee
// seats stay uuid inputs for now. External evaluators additionally have no
// PersonnelProfile at all, so listPersonnel could never cover them.
//
// Round context (purpose/dates) arrives via router state from CycleDetailPage's
// link when navigated in-app; a direct URL/refresh has none (no GET
// /rounds/{roundId} exists to re-fetch it — see CycleDetailPage's header
// comment) — the page still fully functions without it, just without the
// header line.
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import { usePersonnel } from '../../lib/usePersonnel';
import type { components } from '../../api/schema.generated';

type Assignment = components['schemas']['Assignment'];
type Round = components['schemas']['Round'];
type CommitteeRole = components['schemas']['CommitteeMember']['committee_role'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CommitteeRow { evaluatorUserId: string; role: CommitteeRole }

export function RoundAssignmentsPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const location = useLocation();
  const roundFromState = (location.state as { round?: Round } | null)?.round;

  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [error, setError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const { nameFor } = usePersonnel();

  function reload() {
    if (!roundId) return;
    setAssignments(null);
    api.GET('/rounds/{roundId}/assignments', { params: { path: { roundId }, query: { page: 1, page_size: 50 } } })
      .then((res) => setAssignments(unwrap(res).items))
      .catch(() => setError(true));
  }

  useEffect(reload, [roundId]);

  if (!roundId) return null;

  return (
    <main className="page">
      <Link to={roundFromState ? `/director/cycles/${roundFromState.cycle_id}` : '/director/cycles'} className="field-hint">← กลับไปที่รอบการประเมิน</Link>
      <h1>{roundFromState ? `กรรมการและการมอบหมาย — รอบที่ ${roundFromState.round_number}` : 'กรรมการและการมอบหมาย'}</h1>
      {roundFromState && <p className="field-hint">{roundFromState.purpose} ({roundFromState.period_start} – {roundFromState.period_end})</p>}

      <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
        {showCreate ? 'ยกเลิก' : '+ มอบหมายผู้รับการประเมิน'}
      </button>

      {showCreate && (
        <CreateAssignmentForm roundId={roundId} onCreated={() => { setShowCreate(false); reload(); }} />
      )}

      {error && (
        <div className="alert alert-error" role="alert"><span aria-hidden="true">⚠</span><span>โหลดรายการไม่สำเร็จ กรุณาลองใหม่</span></div>
      )}
      {assignments === null && !error && <p className="field-hint">กำลังโหลด…</p>}
      {assignments !== null && assignments.length === 0 && (
        <div className="empty-state"><p>ยังไม่มีการมอบหมายในรอบนี้</p></div>
      )}
      {assignments !== null && assignments.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {assignments.map((a) => (
            <li key={a.id} className="evidence-card" style={{ marginBottom: 'var(--space-2)' }}>
              <div className="title">ผู้รับการประเมิน: {nameFor(a.evaluatee_personnel_id)}</div>
              <span className="status-badge">
                <span className="status-dot" data-state={a.status === 'completed' ? 'clean' : a.status === 'void' ? 'blocked' : 'pending'} aria-hidden="true" />
                {assignmentStatusLabel(a.status)}
              </span>
              <p className="field-hint">คณะกรรมการ {a.committee.length}/3 คน</p>
              <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-3)' }}>
                {a.committee.map((m) => (
                  <li key={m.evaluator_user_id} className="field-hint">
                    ที่นั่ง {m.seat_number} — {m.committee_role === 'chair' ? 'ประธาน' : 'กรรมการ'} ({m.evaluator_user_id})
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function CreateAssignmentForm({ roundId, onCreated }: { roundId: string; onCreated: () => void }) {
  const { personnel, failed: personnelFailed } = usePersonnel();
  const [evaluateePersonnelId, setEvaluateePersonnelId] = useState('');
  const [committee, setCommittee] = useState<CommitteeRow[]>([
    { evaluatorUserId: '', role: 'chair' },
    { evaluatorUserId: '', role: 'member' },
    { evaluatorUserId: '', role: 'member' },
  ]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setCommitteeRow(i: number, evaluatorUserId: string) {
    setCommittee((rows) => rows.map((r, idx) => (idx === i ? { ...r, evaluatorUserId } : r)));
  }

  function validate(): string | null {
    if (!UUID_RE.test(evaluateePersonnelId.trim())) return 'รหัสผู้รับการประเมินต้องเป็น UUID ที่ถูกต้อง';
    const ids = committee.map((r) => r.evaluatorUserId.trim());
    if (ids.some((id) => !UUID_RE.test(id))) return 'รหัสกรรมการทั้ง 3 คนต้องเป็น UUID ที่ถูกต้อง';
    if (new Set(ids).size !== 3) return 'กรรมการทั้ง 3 คนต้องไม่ซ้ำกัน';
    if (committee.filter((r) => r.role === 'chair').length !== 1) return 'ต้องมีประธานกรรมการ 1 คนเท่านั้น';
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setFieldError(validationError); return; }
    setFieldError(null);
    setSubmitting(true);
    try {
      unwrap(await api.POST('/rounds/{roundId}/assignments', {
        params: { path: { roundId } },
        body: {
          evaluatee_personnel_id: evaluateePersonnelId.trim(),
          committee: committee.map((r, i) => ({
            evaluator_user_id: r.evaluatorUserId.trim(), committee_role: r.role, seat_number: i + 1,
          })),
        },
      }));
      onCreated();
    } catch (err) {
      setFieldError(err instanceof ApiError ? thaiMessageFor(err) : 'มอบหมายไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
      <div className="alert alert-info" role="note">
        <span aria-hidden="true">ℹ</span>
        <span>กรรมการยังต้องกรอกรหัส UUID ของบัญชีผู้ใช้ เพราะระบบยังไม่มีหน้าค้นหาบัญชีสำหรับผู้อำนวยการ</span>
      </div>

      <div className="field">
        <label htmlFor="evaluatee">ผู้รับการประเมิน</label>
        {personnel === null && !personnelFailed && <p className="field-hint">กำลังโหลดรายชื่อ…</p>}
        {personnel !== null && personnel.length > 0 && (
          <select id="evaluatee" value={evaluateePersonnelId} onChange={(e) => setEvaluateePersonnelId(e.target.value)} required>
            <option value="">— เลือกผู้รับการประเมิน —</option>
            {personnel.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}{p.employee_code ? ` (${p.employee_code})` : ''}
              </option>
            ))}
          </select>
        )}
        {personnel !== null && personnel.length === 0 && (
          <p className="field-hint">ยังไม่มีบุคลากรในโรงเรียน — ให้ผู้ดูแลระบบเชิญบุคลากรก่อน</p>
        )}
        {/* Degraded, not broken: if the name list fails to load, a director who
            already has the id can still complete the assignment. */}
        {personnelFailed && (
          <input id="evaluatee" type="text" value={evaluateePersonnelId} onChange={(e) => setEvaluateePersonnelId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" required />
        )}
      </div>

      <h2>คณะกรรมการ (3 คน)</h2>
      {committee.map((row, i) => (
        <div className="field" key={i}>
          <label htmlFor={`committee-${i}`}>
            ที่นั่ง {i + 1} — {row.role === 'chair' ? 'ประธานกรรมการ' : 'กรรมการ'}
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input
              id={`committee-${i}`} type="text" value={row.evaluatorUserId}
              onChange={(e) => setCommitteeRow(i, e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000" required
              style={{ flex: 1 }}
            />
            <select
              aria-label={`บทบาทที่นั่ง ${i + 1}`}
              value={row.role}
              onChange={(e) => setCommittee((rows) => rows.map((r, idx) => (idx === i ? { ...r, role: e.target.value as CommitteeRole } : r)))}
            >
              <option value="chair">ประธาน</option>
              <option value="member">กรรมการ</option>
            </select>
          </div>
        </div>
      ))}
      <p className="field-hint">ต้องมีประธาน 1 คนและกรรมการ 2 คน (ว9/ว10: ผอ.สถานศึกษาเป็นประธาน)</p>

      {fieldError && <div className="field-error" role="alert">{fieldError}</div>}

      <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
        {submitting ? 'กำลังมอบหมาย…' : 'มอบหมาย'}
      </button>
    </form>
  );
}

function assignmentStatusLabel(status: Assignment['status']): string {
  switch (status) {
    case 'pending': return 'รอเริ่มให้คะแนน';
    case 'in_progress': return 'กำลังให้คะแนน';
    case 'completed': return 'เสร็จสิ้น';
    case 'void': return 'ยกเลิก';
    default: return status;
  }
}
