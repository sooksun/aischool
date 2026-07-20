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
import { levelTextFor, hasLevelText } from '../../lib/rubricLevels';
import { usePersonnel } from '../../lib/usePersonnel';
import type { components } from '../../api/schema.generated';

type AssignmentDetail = components['schemas']['AssignmentDetail'];
type FrameworkDetail = components['schemas']['FrameworkDetail'];
type Indicator = components['schemas']['Indicator'];
type AssignmentResults = components['schemas']['AssignmentResults'];
type EvaluatorResult = components['schemas']['EvaluatorResult'];
type ScoreSubmission = components['schemas']['ScoreSubmission'];

export function AssignmentScorePage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { nameFor } = usePersonnel();
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
        // include=levels pulls IndicatorLevelDescription rows — the seeded
        // per-(indicator, rank, rubric_level) expected-practice text this page is
        // supposed to score against (ADR-0003). Omitting it was why the UI fell
        // back to four generic phrases while 792 seeded rows went unread.
        const fw = unwrap(await api.GET('/frameworks/{frameworkId}', {
          params: { path: { frameworkId: fwId }, query: { include: 'levels' } },
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
      <p className="field-hint">ผู้รับการประเมิน: {nameFor(detail.evaluatee_personnel_id)}</p>
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

      <ChallengePanel challenge={detail.challenge ?? null} />

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
            const rankCode = detail?.evaluatee_rank_level_code ?? '';
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
                  {RUBRIC_OPTIONS.map((opt) => {
                    // The seeded expected-practice text for THIS indicator at the
                    // evaluatee's rank. Generic label stays as the accessible name
                    // and as the fallback when a rank/level row is absent, so a
                    // gap in seed data degrades to the old behaviour rather than
                    // rendering an empty option.
                    const practice = levelTextFor(ind, rankCode, opt.value);
                    return (
                      <label
                        key={opt.value}
                        style={{ display: 'block', minHeight: 'var(--touch-target)', padding: '6px 0' }}
                      >
                        <input
                          type="radio"
                          name={`rubric-${ind.id}`}
                          checked={row?.rubric_level === opt.value}
                          onChange={() => setLevel(ind.id, opt.value)}
                        />
                        {' '}
                        <strong>{opt.labelTh}</strong>
                        {practice && (
                          <span className="field-hint" style={{ display: 'block', marginLeft: 24 }}>
                            {practice}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                {!hasLevelText(ind, rankCode) && (
                  <p className="field-hint">
                    ยังไม่มีคำอธิบายระดับสำหรับวิทยฐานะนี้ — ใช้เกณฑ์กลาง
                  </p>
                )}
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

/**
 * The evaluatee's ประเด็นท้าทาย, shown while scoring (CCR-015).
 *
 * This panel is the reason contract v3.0 exists. Indicators C.1 / C.2.1 / C.2.2
 * carry 40 of the 100 points and rate exactly these three texts — the method the
 * teacher committed to, and the two targets they set. Until this shipped the
 * committee assigned that 40% having never seen any of it, which made the number
 * look like a judgement when it could not have been one.
 */
function ChallengePanel({ challenge }: { challenge: AssignmentDetail['challenge'] | null }) {
  if (!challenge) {
    // "No agreement filed" is a different fact from "the teacher wrote nothing",
    // and an evaluator needs to be able to tell them apart before scoring 40%.
    return (
      <div className="alert alert-error" role="alert" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <strong>ยังไม่มีข้อตกลง (PA1) ของผู้รับการประเมินในรอบนี้</strong>
        <p style={{ margin: '4px 0 0' }}>
          ส่วนที่ 2 ประเด็นท้าทาย คิดเป็น 40 คะแนน แต่ยังไม่มีข้อความประเด็นท้าทายให้พิจารณา
          กรุณาให้ผู้รับการประเมินจัดทำและส่งข้อตกลงก่อน
        </p>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="challenge-heading"
      style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 16, marginBottom: 16 }}
    >
      <h2 id="challenge-heading" style={{ marginTop: 0 }}>ประเด็นท้าทาย (ส่วนที่ 2 — 40 คะแนน)</h2>
      <p className="field-hint" style={{ marginTop: 0 }}>
        ข้อความที่ผู้รับการประเมินจัดทำไว้ ใช้ประกอบการให้คะแนนตัวชี้วัด C.1 / C.2.1 / C.2.2
      </p>

      <p style={{ fontWeight: 600, marginBottom: 4 }}>{challenge.title}</p>
      {challenge.target_group && (
        <p className="field-hint" style={{ margin: '0 0 12px' }}>กลุ่มเป้าหมาย: {challenge.target_group}</p>
      )}

      <ChallengeField label="วิธีดำเนินการ (C.1 — 20 คะแนน)" value={challenge.method_plan} />
      <ChallengeField label="ผลลัพธ์เชิงปริมาณที่คาดหวัง (C.2.1 — 10 คะแนน)" value={challenge.quantitative_target} />
      <ChallengeField label="ผลลัพธ์เชิงคุณภาพที่คาดหวัง (C.2.2 — 10 คะแนน)" value={challenge.qualitative_target} />
      {challenge.period_note && (
        <p className="field-hint" style={{ marginBottom: 0 }}>ช่วงเวลา: {challenge.period_note}</p>
      )}
    </section>
  );
}

function ChallengeField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontWeight: 600, margin: '0 0 2px', fontSize: '0.875rem' }}>{label}</p>
      {value
        ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{value}</p>
        : <p className="field-hint" style={{ margin: 0 }}>— ผู้รับการประเมินไม่ได้ระบุ —</p>}
    </div>
  );
}
