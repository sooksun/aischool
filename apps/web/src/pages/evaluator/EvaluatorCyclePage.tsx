// Shows rounds in a cycle for evaluators (read-only; no create/transition).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/schema.generated';

type CycleDetail = components['schemas']['CycleDetail'];
type RoundStatus = components['schemas']['RoundStatus'];

function roundStatusLabel(s: RoundStatus): string {
  switch (s) {
    case 'planned': return 'วางแผน';
    case 'open': return 'เปิดแล้ว';
    case 'scoring': return 'กำลังให้คะแนน';
    case 'closed': return 'ปิดแล้ว';
    default: return s;
  }
}

export function EvaluatorCyclePage() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!cycleId) return;
    api.GET('/cycles/{cycleId}', { params: { path: { cycleId } } })
      .then((res) => setCycle(unwrap(res)))
      .catch(() => setError(true));
  }, [cycleId]);

  if (error) {
    return (
      <main className="page">
        <div className="alert alert-error" role="alert">ไม่พบรอบการประเมินนี้</div>
        <Link to="/evaluator" className="btn btn-secondary">กลับ</Link>
      </main>
    );
  }
  if (!cycle) return <main className="page"><p className="field-hint">กำลังโหลด…</p></main>;

  return (
    <main className="page">
      <Link to="/evaluator" className="field-hint">← งานกรรมการทั้งหมด</Link>
      <h1>{cycle.title}</h1>
      <p className="field-hint">ปีงบประมาณ {cycle.fiscal_year}</p>

      <h2>รอบย่อย</h2>
      {cycle.rounds.length === 0 && <p className="field-hint">ยังไม่มีรอบย่อย</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {cycle.rounds.map((r) => (
          <li key={r.id}>
            <Link
              to={`/evaluator/rounds/${r.id}`}
              state={{
                round: r,
                frameworkVersionId: cycle.framework_version_id,
                cycleTitle: cycle.title,
              }}
              className="evidence-card"
            >
              <div className="title">รอบที่ {r.round_number}: {r.purpose}</div>
              <p className="field-hint">{r.period_start} – {r.period_end}</p>
              <span className="status-badge">
                <span
                  className="status-dot"
                  data-state={r.status === 'closed' ? 'blocked' : r.status === 'scoring' || r.status === 'open' ? 'clean' : 'pending'}
                  aria-hidden="true"
                />
                {roundStatusLabel(r.status)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
