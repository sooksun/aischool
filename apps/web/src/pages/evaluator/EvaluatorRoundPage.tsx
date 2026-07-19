// Lists assignments in a round visible to the committee member.
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { usePersonnel } from '../../lib/usePersonnel';
import type { components } from '../../api/schema.generated';

type Assignment = components['schemas']['Assignment'];
type Round = components['schemas']['Round'];

export function EvaluatorRoundPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const { nameFor } = usePersonnel();
  const location = useLocation();
  const nav = (location.state as {
    round?: Round;
    frameworkVersionId?: string;
    cycleTitle?: string;
  } | null) ?? {};

  const [items, setItems] = useState<Assignment[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!roundId) return;
    api.GET('/rounds/{roundId}/assignments', {
      params: { path: { roundId }, query: { page: 1, page_size: 50 } },
    })
      .then((res) => setItems(unwrap(res).items))
      .catch(() => setError(true));
  }, [roundId]);

  if (!roundId) return null;

  return (
    <main className="page">
      <Link to="/evaluator" className="field-hint">← งานกรรมการ</Link>
      <h1>
        {nav.round
          ? `มอบหมาย — รอบที่ ${nav.round.round_number}`
          : 'รายการมอบหมายของฉัน'}
      </h1>
      {nav.cycleTitle && <p className="field-hint">{nav.cycleTitle}</p>}
      {nav.round && (
        <p className="field-hint">{nav.round.purpose} ({nav.round.period_start} – {nav.round.period_end})</p>
      )}

      {error && (
        <div className="alert alert-error" role="alert">โหลดรายการไม่สำเร็จ</div>
      )}
      {items === null && !error && <p className="field-hint">กำลังโหลด…</p>}
      {items !== null && items.length === 0 && (
        <div className="empty-state">
          <p>คุณไม่ได้อยู่ในคณะกรรมการของการมอบหมายใดในรอบนี้</p>
        </div>
      )}
      {items !== null && items.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((a) => (
            <li key={a.id}>
              <Link
                to={`/evaluator/assignments/${a.id}`}
                state={{
                  frameworkVersionId: nav.frameworkVersionId,
                  round: nav.round,
                }}
                className="evidence-card"
              >
                <div className="title">ผู้รับการประเมิน: {nameFor(a.evaluatee_personnel_id)}</div>
                <p className="field-hint">สถานะ: {a.status} · กรรมการ {a.committee.length}/3</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
