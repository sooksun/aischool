// FR-060 / FR-061: the committee's read-only view of one evaluatee's confirmed
// evidence, grouped by indicator. No AI confidence or rationale here — the API
// sends none. Each item opens on its evidence page, where a committee member
// can validate or return the mapping.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import type { components } from '../../api/schema.generated';
import { AssignmentComments } from '../../components/AssignmentComments';
import { provenanceLabel } from '../../lib/provenance';

type Item = components['schemas']['AssignmentEvidenceItem'];

export function AssignmentEvidencePage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [items, setItems] = useState<Item[] | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assignmentId) return;
    (async () => {
      try {
        const all: Item[] = [];
        let cursor: string | undefined;
        do {
          const page = unwrap(await api.GET('/assignments/{assignmentId}/evidence', {
            params: { path: { assignmentId }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
          }));
          all.push(...page.items);
          cursor = page.next_cursor ?? undefined;
        } while (cursor);
        setItems(all);
        const fwId = all[0]?.mapping.framework_version_id;
        if (fwId) {
          const fw = unwrap(await api.GET('/frameworks/{frameworkId}', { params: { path: { frameworkId: fwId } } }));
          setCodes(Object.fromEntries(fw.domains.flatMap((d) => d.indicators).map((i) => [i.id, `${i.code} ${i.name_th}`])));
        }
      } catch (e) {
        setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดไม่สำเร็จ');
      }
    })();
  }, [assignmentId]);

  const groups = new Map<string, Item[]>();
  for (const it of items ?? []) groups.set(it.indicator_id, [...(groups.get(it.indicator_id) ?? []), it]);

  return (
    <main className="page">
      <h1>หลักฐานของผู้รับการประเมิน</h1>
      <p className="field-hint">เฉพาะหลักฐานที่เจ้าของยืนยันแล้ว จัดตามตัวชี้วัด (อ่านอย่างเดียว)</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {items !== null && items.length === 0 && <p className="field-hint">ยังไม่มีหลักฐานที่ยืนยันแล้ว</p>}
      {[...groups.entries()].map(([indicatorId, list]) => (
        <section key={indicatorId} aria-label={codes[indicatorId] ?? indicatorId}>
          <h2>{codes[indicatorId] ?? 'ตัวชี้วัด'}</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {list.map((it) => (
              <li key={it.mapping.id}>
                <Link to={`/evidence/${it.evidence.id}`} className="evidence-card">
                  <div className="title">{it.evidence.title}</div>
                  <p className="field-hint">
                    {provenanceLabel(it.mapping.mapping_source)} · {it.mapping.status === 'validated' ? 'รับรองแล้ว' : 'รอรับรอง'} · ไฟล์ {it.files.length}
                    {it.evidence.injection_suspected ? ' · ⚠ อาจมีคำสั่งแฝง' : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {assignmentId && <AssignmentComments assignmentId={assignmentId} indicatorId={indicatorId} canOpen />}
        </section>
      ))}
    </main>
  );
}
