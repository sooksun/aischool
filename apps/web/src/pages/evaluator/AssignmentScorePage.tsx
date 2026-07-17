// Submit per-evaluator scores + view results (SEIP-UI-003).
// SCORE-002/004/005 surfaced via thaiMessageFor; server remains authority.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import {
  RUBRIC_OPTIONS,
  validateScoreForm,
  type ScoreRowInput,
} from '../../components/scoring/validateScoreForm';
import type { components } from '../../api/schema.generated';

type AssignmentDetail = components['schemas']['AssignmentDetail'];
type FrameworkDetail = components['schemas']['FrameworkDetail'];
type Indicator = components['schemas']['Indicator'];
type AssignmentResults = components['schemas']['AssignmentResults'];
type EvaluatorResult = components['schemas']['EvaluatorResult'];
type ScoreSubmission = components['schemas']['ScoreSubmission'];

export function AssignmentScorePage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  // Router state may still pass frameworkVersionId; API framework_version_id is source of truth (CCR-009).
  const location = useLocation();
  const navFrameworkId = (location.state as { frameworkVersionId?: string } | null)?.frameworkVersionId;

  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [framework, setFramework] = useState<FrameworkDetail | null>(null);
  const [results, setResults] = useState<AssignmentResults | null>(null);
  const [rows, setRows] = useState<ScoreRowInput[]>([]);
  const [workloadMet, setWorkloadMet] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastRollup, setLastRollup] = useState<EvaluatorResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const scorable = useMemo(() => {
    if (!framework) return [] as Indicator[];
    return framework.domains
      .flatMap((d) => d.indicators)
      .filter((i) => i.is_scored && i.indicator_kind !== 'workload_gate')
      .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  }, [framework]);

  useEffect(() => {
    if (!assignmentId) return;
    let cancelled = false;

    (async () => {
      try {
        const d = unwrap(await api.GET('/assignments/{assignmentId}', {
          params: { path: { assignmentId } },
        })) as AssignmentDetail;
        if (cancelled) return;
        setDetail(d);

        const fwId = d.framework_version_id || navFrameworkId;
        if (!fwId) {
          setError('ไม่พบกรอบตัวชี้วัดของการมอบหมายนี้');
          return;
        }
        const fw = unwrap(await api.GET('/frameworks/{frameworkId}', {
          params: { path: { frameworkId: fwId } },
        })) as FrameworkDetail;
        if (cancelled) return;
        setFramework(fw);

        const scored = fw.domains
          .flatMap((dom) => dom.indicators)
          .filter((i) => i.is_scored && i.indicator_kind !== 'workload_gate');
        setRows(scored.map((i) => ({ indicator_id: i.id, rubric_level: null, comment: null })));
        setWorkloadMet(d.workload_met ?? null);

        try {
          const r = unwrap(await api.GET('/assignments/{assignmentId}/results', {
            params: { path: { assignmentId } },
          })) as AssignmentResults;
          if (!cancelled) setResults(r);
        } catch {
          if (!cancelled) setResults(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? thaiMessageFor(err) : 'โหลดข้อมูลไม่สำเร็จ');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [assignmentId, navFrameworkId]); // navFrameworkId only as rare fallback before API field

  function setLevel(indicatorId: string, level: number) {
    setRows((prev) => prev.map((r) => (
      r.indicator_id === indicatorId ? { ...r, rubric_level: level } : r
    )));
  }

  function setComment(indicatorId: string, comment: string) {
    setRows((prev) => prev.map((r) => (
      r.indicator_id === indicatorId ? { ...r, comment } : r
    )));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assignmentId) return;
    setSubmitError(null);
    const ids = scorable.map((i) => i.id);
    const v = validateScoreForm(ids, rows);
    if (!v.ok) {
      setSubmitError(v.messageTh ?? 'ข้อมูลไม่ครบ');
      return;
    }
    setSubmitting(true);
    try {
      const body: ScoreSubmission = {
        indicator_scores: rows.map((r) => ({
          indicator_id: r.indicator_id,
          rubric_level: r.rubric_level as 1 | 2 | 3 | 4,
          comment: r.comment ?? null,
        })),
        workload_met: workloadMet,
      };
      const rollup = unwrap(await api.PUT('/assignments/{assignmentId}/my-scores', {
        params: { path: { assignmentId } },
        body,
      })) as EvaluatorResult;
      setLastRollup(rollup);
      const d = unwrap(await api.GET('/assignments/{assignmentId}', {
        params: { path: { assignmentId } },
      })) as AssignmentDetail;
      setDetail(d);
      try {
        const r = unwrap(await api.GET('/assignments/{assignmentId}/results', {
          params: { path: { assignmentId } },
        })) as AssignmentResults;
        setResults(r);
      } catch {
        /* mid-round evaluatee path — API may return PERM-001 until round closed */
      }
    } catch (err) {
      setSubmitError(err instanceof ApiError ? thaiMessageFor(err) : 'บันทึกคะแนนไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <main className="page">
        <div className="alert alert-error" role="alert">{error}</div>
        <Link to="/evaluator" className="btn btn-secondary">กลับ</Link>
      </main>
    );
  }
  if (!detail || !framework) {
    return <main className="page"><p className="field-hint">กำลังโหลด…</p></main>;
  }

  const member = detail.my_submission_state !== 'not_member';

  return (
    <main className="page">
      <Link to="/evaluator" className="field-hint">← งานกรรมการ</Link>
      <h1>ให้คะแนนการประเมิน</h1>
      <p className="field-hint">ผู้รับการประเมิน: {detail.evaluatee_personnel_id}</p>
      <p className="field-hint">
        สถานะการส่งของฉัน:{' '}
        {detail.my_submission_state === 'submitted'
          ? 'ส่งแล้ว (ส่งใหม่ได้ถ้ายังไม่ปิดรอบ)'
          : detail.my_submission_state === 'not_submitted'
            ? 'ยังไม่ได้ส่ง'
            : 'คุณไม่ใช่กรรมการรายการนี้'}
      </p>
      <p className="field-hint">
        ภาระงาน (gate):{' '}
        {detail.workload_gate_declared
          ? (detail.workload_met ? 'ผ่าน' : 'ไม่ผ่าน')
          : 'ยังไม่ได้ประกาศ (ประธานต้องประกาศก่อนส่งคะแนน — SCORE-004)'}
      </p>

      {member && (
        <form onSubmit={onSubmit} noValidate>
          <fieldset
            className="field"
            style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 16 }}
          >
            <legend>ภาระงาน (ประธานกรรมการ)</legend>
            <p className="field-hint">
              เฉพาะประธานที่ส่งค่านี้จะถูกบันทึก — กรรมการอื่นไม่ต้องเลือกก็ได้
            </p>
            <label style={{ display: 'block', minHeight: 'var(--touch-target)' }}>
              <input
                type="radio"
                name="workload"
                checked={workloadMet === true}
                onChange={() => setWorkloadMet(true)}
              />{' '}
              ผ่านเกณฑ์ภาระงาน
            </label>
            <label style={{ display: 'block', minHeight: 'var(--touch-target)' }}>
              <input
                type="radio"
                name="workload"
                checked={workloadMet === false}
                onChange={() => setWorkloadMet(false)}
              />{' '}
              ไม่ผ่านเกณฑ์ภาระงาน
            </label>
          </fieldset>

          <h2>ตัวชี้วัด ({scorable.length} ข้อ)</h2>
          {scorable.map((ind) => {
            const row = rows.find((r) => r.indicator_id === ind.id);
            return (
              <fieldset
                key={ind.id}
                className="field"
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                <legend>
                  <strong>{ind.code}</strong>
                  {' '}
                  {ind.name_th}
                  {ind.indicator_kind === 'challenge' ? ' (ประเด็นท้าทาย)' : ''}
                </legend>
                <div role="radiogroup" aria-label={`ระดับคะแนน ${ind.code}`}>
                  {RUBRIC_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      style={{ display: 'block', minHeight: 'var(--touch-target)', padding: '4px 0' }}
                    >
                      <input
                        type="radio"
                        name={`rubric-${ind.id}`}
                        checked={row?.rubric_level === opt.value}
                        onChange={() => setLevel(ind.id, opt.value)}
                      />
                      {' '}
                      {opt.labelTh}
                    </label>
                  ))}
                </div>
                <label htmlFor={`c-${ind.id}`} className="field-hint">ความเห็น (ไม่บังคับ)</label>
                <textarea
                  id={`c-${ind.id}`}
                  rows={2}
                  value={row?.comment ?? ''}
                  onChange={(e) => setComment(ind.id, e.target.value)}
                  style={{ width: '100%' }}
                />
              </fieldset>
            );
          })}

          {submitError && (
            <div className="alert alert-error" role="alert">
              <span aria-hidden="true">⚠</span>
              <span>{submitError}</span>
            </div>
          )}

          {lastRollup && (
            <div
              className="alert"
              role="status"
              style={{ background: 'var(--color-success-bg, #ecfdf5)', marginBottom: 16 }}
            >
              บันทึกแล้ว — รวม
              {' '}
              {lastRollup.total_percent}
              %
              {lastRollup.passed_individual_threshold ? ' (ถึงเกณฑ์ ≥70%)' : ' (ยังไม่ถึงเกณฑ์ ≥70%)'}
              {' '}
              · ส่วนที่ 1
              {' '}
              {lastRollup.part1_percent}
              % · ส่วนที่ 2
              {' '}
              {lastRollup.part2_percent}
              %
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ minHeight: 'var(--touch-target)', width: '100%' }}
          >
            {submitting ? 'กำลังบันทึก…' : 'บันทึกคะแนนของฉัน'}
          </button>
        </form>
      )}

      <h2 style={{ marginTop: 32 }}>ผลการประเมินรวม</h2>
      {!results && (
        <p className="field-hint">
          ยังไม่สามารถดูผลรวมได้ (อาจยังไม่ปิดรอบ หรือคุณไม่มีสิทธิ์) —
          ผู้รับการประเมินเห็นผลได้เมื่อรอบปิดแล้วเท่านั้น
        </p>
      )}
      {results && (
        <div className="evidence-card">
          <p>
            ภาระงาน:
            {' '}
            {results.workload_gate_met === null ? 'ยังไม่ประกาศ' : results.workload_gate_met ? 'ผ่าน' : 'ไม่ผ่าน'}
          </p>
          <p>
            ครบทุกกรรมการ:
            {' '}
            {results.complete ? 'ใช่' : 'ยังไม่ครบ'}
          </p>
          <p>
            ผ่านโดยรวม:
            {' '}
            {results.overall_pass === null
              ? 'ยังสรุปไม่ได้'
              : results.overall_pass
                ? 'ผ่าน (ทุกคน ≥70% และภาระงานผ่าน)'
                : 'ไม่ผ่าน'}
          </p>
          <ul style={{ paddingLeft: 20 }}>
            {results.evaluator_results.map((er) => (
              <li key={er.evaluator_user_id} className="field-hint">
                {er.evaluator_user_id}
                :
                {' '}
                {er.total_percent}
                %
                {er.passed_individual_threshold ? ' ✓' : ' ✗'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
