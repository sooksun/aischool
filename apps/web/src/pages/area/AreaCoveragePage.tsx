// FR-057: the area admin's readiness view — per school, how many staff and how
// many indicators still have no confirmed evidence anywhere in that school.
// Counts only: no names, no evidence (getCoverage at school / area scope).
import { useEffect, useState } from 'react';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import type { components } from '../../api/schema.generated';
import { useAuth } from '../../hooks/useAuth';

type Report = components['schemas']['CoverageReport'];
type School = components['schemas']['AreaSchool'];
type RoleFamily = 'teacher' | 'administrator';

const gaps = (r: Report) => r.indicators.filter((i) => i.validated + i.owner_confirmed === 0).length;

export function AreaCoveragePage() {
  const { user } = useAuth();
  const areaIds = [...new Set((user?.memberships ?? []).filter((m) => m.role === 'area_admin' && m.area_id).map((m) => m.area_id!))];
  const areaId = areaIds[0] ?? '';
  const [family, setFamily] = useState<RoleFamily>('teacher');
  const [area, setArea] = useState<Report | null>(null);
  const [rows, setRows] = useState<{ school: School; report: Report }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!areaId) return;
    setArea(null);
    setRows(null);
    setError(null);
    (async () => {
      try {
        const fws = unwrap(await api.GET('/frameworks', { params: { query: { role_family: family, status: 'active' } } }));
        if (fws.length === 0) { setError('ยังไม่มีกรอบการประเมินที่ใช้งานได้'); return; }
        const fw = fws[0].id;
        const q = (subject_type: 'area' | 'school', subject_id: string) =>
          api.GET('/coverage', { params: { query: { subject_type, subject_id, framework_version_id: fw } } }).then(unwrap);
        setArea(await q('area', areaId));
        const schools = unwrap(await api.GET('/areas/{areaId}/schools', { params: { path: { areaId } } }));
        setRows(await Promise.all(schools.filter((s) => s.status === 'active').map(async (school) => ({ school, report: await q('school', school.id) }))));
      } catch (e) {
        setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดไม่สำเร็จ');
      }
    })();
  }, [areaId, family]);

  return (
    <main className="page">
      <h1>ความพร้อมรายโรงเรียน</h1>
      <p className="field-hint">แสดงเฉพาะจำนวน ไม่มีชื่อบุคลากรหรือเนื้อหาหลักฐาน</p>
      <div className="chip-list" role="radiogroup" aria-label="กรอบการประเมิน">
        <button type="button" className="chip" role="radio" aria-checked={family === 'teacher'} onClick={() => setFamily('teacher')}>ครู (ว9)</button>
        <button type="button" className="chip" role="radio" aria-checked={family === 'administrator'} onClick={() => setFamily('administrator')}>ผู้บริหาร (ว10)</button>
      </div>
      {!areaId && <p className="field-hint">บัญชีนี้ไม่ได้ดูแลเขตใด</p>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {area && (
        <p role="status">
          ทั้งเขต: บุคลากร {area.people_count ?? 0} คน · ยังไม่มีหลักฐานใน {gaps(area)} จาก {area.indicators.length} ตัวชี้วัด
        </p>
      )}
      {rows && (
        <table className="table" aria-label="รายโรงเรียน">
          <thead><tr><th>โรงเรียน</th><th>บุคลากร</th><th>ตัวชี้วัดที่ยังว่าง</th><th>รอรับรอง</th><th>รับรองแล้ว</th></tr></thead>
          <tbody>
            {rows.map(({ school, report }) => (
              <tr key={school.id}>
                <td>{school.name}</td>
                <td>{report.people_count ?? 0}</td>
                <td>{gaps(report)}</td>
                <td>{report.indicators.reduce((n, i) => n + i.owner_confirmed, 0)}</td>
                <td>{report.indicators.reduce((n, i) => n + i.validated, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
