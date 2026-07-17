// Evaluator landing: browse cycles → rounds → assignments where the caller
// is on the committee (listAssignments with committee grant filters server-side).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/schema.generated';

type Cycle = components['schemas']['Cycle'];

export function EvaluatorHomePage() {
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.GET('/cycles', {})
      .then((res) => setCycles(unwrap(res)))
      .catch(() => setError(true));
  }, []);

  return (
    <main className="page">
      <h1>งานกรรมการประเมิน</h1>
      <p className="field-hint">เลือกรอบการประเมินเพื่อดูรายการที่คุณได้รับมอบหมายเป็นกรรมการ</p>

      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>โหลดรายการไม่สำเร็จ</span>
        </div>
      )}
      {cycles === null && !error && <p className="field-hint">กำลังโหลด…</p>}
      {cycles !== null && cycles.length === 0 && (
        <div className="empty-state"><p>ยังไม่มีรอบการประเมินในโรงเรียนนี้</p></div>
      )}
      {cycles !== null && cycles.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {cycles.map((c) => (
            <li key={c.id}>
              <Link
                to={`/evaluator/cycles/${c.id}`}
                state={{ cycle: c }}
                className="evidence-card"
              >
                <div className="title">{c.title}</div>
                <p className="field-hint">ปีงบประมาณ {c.fiscal_year} · {c.starts_on} – {c.ends_on}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
