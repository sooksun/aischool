// The evaluatee's own assignments across cycles and rounds, each linking to the
// committee's comments for them (CCR-028). Reads only what the matrix already
// grants a teacher: cycles at their school, and assignments where they are the
// evaluatee (listAssignments `own` filters to them).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import { useAuth } from '../hooks/useAuth';

interface Row { assignmentId: string; cycleTitle: string; roundNumber: number; status: string }

export function MyAssessmentsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const myPersonnelId = user?.personnel?.id;
    if (!myPersonnelId) { setRows([]); return; }
    (async () => {
      try {
        const out: Row[] = [];
        for (const c of unwrap(await api.GET('/cycles', {}))) {
          const cycle = unwrap(await api.GET('/cycles/{cycleId}', { params: { path: { cycleId: c.id } } }));
          for (const r of cycle.rounds ?? []) {
            const page = unwrap(await api.GET('/rounds/{roundId}/assignments', { params: { path: { roundId: r.id }, query: { page_size: 100 } } }));
            // A director's grant lists the whole round: keep only their own assessment.
            for (const a of page.items.filter((x) => x.evaluatee_personnel_id === myPersonnelId)) {
              out.push({ assignmentId: a.id, cycleTitle: cycle.title, roundNumber: r.round_number, status: a.status });
            }
          }
        }
        setRows(out);
      } catch (e) {
        setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดไม่สำเร็จ');
      }
    })();
  }, [user]);

  return (
    <main className="page">
      <h1>การประเมินของฉัน</h1>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {rows === null && !error && <p className="field-hint">กำลังโหลด…</p>}
      {rows !== null && rows.length === 0 && <p className="field-hint">ยังไม่มีการประเมินที่มอบหมายให้คุณ</p>}
      <ul style={{ listStyle: 'none', padding: 0 }} aria-label="การประเมินของฉัน">
        {(rows ?? []).map((r) => (
          <li key={r.assignmentId}>
            <Link to={`/assignments/${r.assignmentId}/comments`} className="evidence-card">
              <div className="title">{r.cycleTitle} — รอบที่ {r.roundNumber}</div>
              <p className="field-hint">สถานะ: {r.status} · ดูความเห็นจากกรรมการ →</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
