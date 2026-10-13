// CCR-021 / FR-090: the area admin's schools — open one, rename or close it, and
// appoint its first school_admin. The invite token is shown once, as on MembersPage.
import { useEffect, useState } from 'react';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import type { components } from '../../api/schema.generated';
import { useAuth } from '../../hooks/useAuth';

type AreaSchool = components['schemas']['AreaSchool'];

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? thaiMessageFor(e) : fallback);

export function AreaSchoolsPage() {
  const { user } = useAuth();
  const areaIds = [...new Set((user?.memberships ?? []).filter((m) => m.role === 'area_admin' && m.area_id).map((m) => m.area_id!))];
  const [areaId, setAreaId] = useState<string>(areaIds[0] ?? '');
  const [schools, setSchools] = useState<AreaSchool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [appointFor, setAppointFor] = useState<AreaSchool | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [issued, setIssued] = useState<{ school: string; email: string; token: string | null } | null>(null);

  function reload() {
    if (!areaId) return;
    setSchools(null);
    api.GET('/areas/{areaId}/schools', { params: { path: { areaId } } })
      .then((res) => setSchools(unwrap(res)))
      .catch((e) => setError(errorText(e, 'โหลดรายชื่อโรงเรียนไม่สำเร็จ')));
  }
  useEffect(reload, [areaId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      unwrap(await api.POST('/areas/{areaId}/schools', { params: { path: { areaId } }, body: { code: code.trim(), name: name.trim() } }));
      setCode(''); setName('');
      reload();
    } catch (err) { setError(errorText(err, 'เพิ่มโรงเรียนไม่สำเร็จ')); }
  }

  async function setStatus(s: AreaSchool, status: 'active' | 'inactive') {
    if (status === 'inactive' && !window.confirm(`ปิด ${s.name}? บุคลากรของโรงเรียนจะเข้าใช้งานไม่ได้จนกว่าจะเปิดอีกครั้ง`)) return;
    setError(null);
    try {
      unwrap(await api.PATCH('/schools/{schoolId}', { params: { path: { schoolId: s.id } }, body: { status } }));
      reload();
    } catch (err) { setError(errorText(err, 'บันทึกไม่สำเร็จ')); }
  }

  async function appoint(e: React.FormEvent) {
    e.preventDefault();
    if (!appointFor) return;
    setError(null);
    try {
      const r = unwrap(await api.POST('/schools/{schoolId}/admins', {
        params: { path: { schoolId: appointFor.id } }, body: { email: email.trim(), display_name: displayName.trim() },
      }));
      setIssued({ school: appointFor.name, email: email.trim(), token: r.invite_token ?? null });
      setAppointFor(null); setEmail(''); setDisplayName('');
    } catch (err) { setError(errorText(err, 'แต่งตั้งไม่สำเร็จ')); }
  }

  if (areaIds.length === 0) return <main className="page"><p>บัญชีนี้ไม่ได้เป็นผู้ดูแลเขตพื้นที่</p></main>;

  return (
    <main className="page">
      <h1>โรงเรียนในเขตพื้นที่</h1>
      {areaIds.length > 1 && (
        <select aria-label="เขตพื้นที่" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          {areaIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      )}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {issued && (
        <div className="alert alert-info" role="status">
          {issued.token
            ? <>ส่งรหัสเชิญนี้ให้ {issued.email} ({issued.school}) — แสดงครั้งเดียวเท่านั้น: <code>{issued.token}</code></>
            : <>{issued.email} มีบัญชีอยู่แล้ว ได้รับสิทธิ์ผู้ดูแลระบบโรงเรียน {issued.school} แล้ว</>}
          <button type="button" className="btn" onClick={() => setIssued(null)}>ปิด</button>
        </div>
      )}

      <form onSubmit={create} className="card">
        <h2>เพิ่มโรงเรียน</h2>
        <label>รหัสโรงเรียน <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={50} required /></label>
        <label>ชื่อโรงเรียน <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required /></label>
        <button type="submit" className="btn btn-primary">เพิ่มโรงเรียน</button>
      </form>

      {schools === null ? <p>กำลังโหลด…</p> : (
        <table className="table">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th><th /></tr></thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id}>
                <td>{s.code}</td>
                <td>{s.name}</td>
                <td>{s.status === 'active' ? 'เปิดใช้งาน' : 'ปิดแล้ว'}</td>
                <td>
                  {s.status === 'active' && <button type="button" className="btn" onClick={() => setAppointFor(s)}>แต่งตั้งผู้ดูแลโรงเรียน</button>}
                  {s.status === 'active'
                    ? <button type="button" className="btn" onClick={() => setStatus(s, 'inactive')}>ปิดโรงเรียน</button>
                    : <button type="button" className="btn" onClick={() => setStatus(s, 'active')}>เปิดอีกครั้ง</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {appointFor && (
        <form onSubmit={appoint} className="card">
          <h2>แต่งตั้งผู้ดูแลระบบโรงเรียน — {appointFor.name}</h2>
          <label>อีเมล <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>ชื่อที่แสดง <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={200} required /></label>
          <button type="submit" className="btn btn-primary">ส่งคำเชิญ</button>
          <button type="button" className="btn" onClick={() => setAppointFor(null)}>ยกเลิก</button>
        </form>
      )}
    </main>
  );
}
