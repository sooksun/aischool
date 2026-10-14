// CCR-028: the evaluatee's view of the committee's comments on their assignment,
// grouped by indicator, where they reply. Reached from a link (a notification,
// once its kind is approved).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import { AssignmentComments } from '../components/AssignmentComments';

export function AssignmentCommentsPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [indicators, setIndicators] = useState<{ id: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assignmentId) return;
    (async () => {
      try {
        const all = unwrap(await api.GET('/assignments/{assignmentId}/comments', { params: { path: { assignmentId } } }));
        const a = unwrap(await api.GET('/assignments/{assignmentId}', { params: { path: { assignmentId } } }));
        const fw = unwrap(await api.GET('/frameworks/{frameworkId}', { params: { path: { frameworkId: a.framework_version_id } } }));
        const label = Object.fromEntries(fw.domains.flatMap((d) => d.indicators).map((i) => [i.id, `${i.code} ${i.name_th}`]));
        setIndicators([...new Set(all.map((c) => c.indicator_id))].map((id) => ({ id, label: label[id] ?? id })));
      } catch (e) {
        setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดไม่สำเร็จ');
      }
    })();
  }, [assignmentId]);

  return (
    <main className="page">
      <h1>ความเห็นจากกรรมการ</h1>
      <p className="field-hint">ความเห็นและการขอข้อมูลเพิ่มรายตัวชี้วัด (ไม่มีคะแนน) — ตอบได้ใต้แต่ละข้อ</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {indicators !== null && indicators.length === 0 && <p className="field-hint">ยังไม่มีความเห็น</p>}
      {assignmentId && (indicators ?? []).map((i) => (
        <section key={i.id} aria-label={i.label}>
          <h2>{i.label}</h2>
          <AssignmentComments assignmentId={assignmentId} indicatorId={i.id} canOpen={false} />
        </section>
      ))}
    </main>
  );
}
