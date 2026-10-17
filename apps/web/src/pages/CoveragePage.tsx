// FR-052 / FR-056: indicator coverage. A person sees their own portfolio per
// indicator; a director or school admin can switch to the whole school, which
// is counts only (never names). Gaps — indicators with nothing confirmed —
// are what this page is for.
import { useEffect, useState } from 'react';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';
import { useAuth } from '../hooks/useAuth';

type Report = components['schemas']['CoverageReport'];

export function CoveragePage() {
  const { user, schoolId, capabilities } = useAuth();
  const [scope, setScope] = useState<'person' | 'school'>('person');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canSeeSchool = capabilities.manageCycles || capabilities.manageMembers; // director / school_admin

  useEffect(() => {
    if (!user) return;
    const subjectId = scope === 'person' ? user.person_id : schoolId;
    if (!subjectId) { setError('ยังไม่มีข้อมูลบุคลากรของบัญชีนี้'); return; }
    setError(null);
    setReport(null);
    // A switch of scope while the previous request is in flight must not let the
    // older answer land last and overwrite the view the user picked.
    let stale = false;
    (async () => {
      try {
        const role = user.personnel?.position_role ?? 'teacher';
        const fws = unwrap(await api.GET('/frameworks', { params: { query: { role_family: role, status: 'active' } } }));
        if (stale) return;
        if (fws.length === 0) { setError('ยังไม่มีกรอบการประเมินที่ใช้งานได้'); return; }
        const r = unwrap(await api.GET('/coverage', {
          params: { query: { subject_type: scope, subject_id: subjectId, framework_version_id: fws[0].id } },
        }));
        if (!stale) setReport(r);
      } catch (e) {
        if (!stale) setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดไม่สำเร็จ');
      }
    })();
    return () => { stale = true; };
  }, [user, schoolId, scope]);

  const gaps = report?.indicators.filter((i) => i.validated + i.owner_confirmed === 0).length ?? 0;
  return (
    <main className="page">
      <h1>ความครอบคลุมตัวชี้วัด</h1>
      {canSeeSchool && (
        <div className="chip-list" role="radiogroup" aria-label="มุมมอง">
          <button type="button" className="chip" role="radio" aria-checked={scope === 'person'} onClick={() => setScope('person')}>ของฉัน</button>
          <button type="button" className="chip" role="radio" aria-checked={scope === 'school'} onClick={() => setScope('school')}>ทั้งโรงเรียน</button>
        </div>
      )}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {report && (
        <>
          <p className="field-hint" role="status">
            {scope === 'school' && report.people_count != null ? `บุคลากร ${report.people_count} คน · ` : ''}
            {gaps > 0 ? `ยังไม่มีหลักฐานใน ${gaps} ตัวชี้วัด` : 'มีหลักฐานครบทุกตัวชี้วัดแล้ว'}
          </p>
          <table className="table" aria-label="ตัวชี้วัด">
            <thead>
              <tr><th>ตัวชี้วัด</th><th>รับรองแล้ว</th><th>รอรับรอง</th><th>ส่งกลับ</th><th>คำแนะนำที่รอ</th></tr>
            </thead>
            <tbody>
              {report.indicators.map((i) => (
                <tr key={i.indicator_id} data-gap={i.validated + i.owner_confirmed === 0 ? 'true' : undefined}>
                  <td>{i.indicator_code}{i.validated + i.owner_confirmed === 0 && ' ⚠'}</td>
                  <td>{i.validated}</td>
                  <td>{i.owner_confirmed}</td>
                  <td>{i.returned}</td>
                  <td>{i.open_suggestions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
