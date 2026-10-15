// FR-117 (CCR-029): a person asks about their own data — a copy, a correction,
// erasure, restriction or an objection — and follows the DPO's decision. An
// approved copy arrives as a portfolio export on the "ส่งออก" page.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import { REQUEST_STATUS_TH, REQUEST_TYPE_TH, thaiDate, type SubjectRequest, type SubjectRequestType } from '../../lib/subject-requests';

export function PrivacyRequestsPage() {
  const [items, setItems] = useState<SubjectRequest[] | null>(null);
  const [type, setType] = useState<SubjectRequestType>('access');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(unwrap(await api.GET('/subject-requests', { params: { query: { limit: 50 } } })).items);
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดไม่สำเร็จ');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      unwrap(await api.POST('/subject-requests', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { request_type: type, details: details.trim() || null },
      }));
      setDetails('');
      setDone(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? thaiMessageFor(err) : 'ส่งคำขอไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <h1>คำขอเกี่ยวกับข้อมูลส่วนบุคคลของฉัน</h1>
      <p className="field-hint">
        คำขอจะส่งถึงเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO) ของ สพท. ของโรงเรียนนี้ โดยทั่วไปควรได้คำตอบภายใน 30 วัน
      </p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {done && <div className="alert" role="status">ส่งคำขอแล้ว</div>}
      <form onSubmit={(e) => void submit(e)} aria-label="ยื่นคำขอ">
        <label className="field">
          ประเภทคำขอ
          <select value={type} onChange={(e) => setType(e.target.value as SubjectRequestType)}>
            {(Object.keys(REQUEST_TYPE_TH) as SubjectRequestType[]).map((t) => <option key={t} value={t}>{REQUEST_TYPE_TH[t]}</option>)}
          </select>
        </label>
        <label className="field">
          รายละเอียด (ถ้ามี)
          <textarea value={details} maxLength={2000} rows={3} onChange={(e) => setDetails(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>ยื่นคำขอ</button>
      </form>

      <h2>คำขอที่ยื่นไว้</h2>
      {items !== null && items.length === 0 && <p className="field-hint">ยังไม่เคยยื่นคำขอ</p>}
      <ul style={{ listStyle: 'none', padding: 0 }} aria-label="คำขอของฉัน">
        {(items ?? []).map((r) => (
          <li key={r.id} className="evidence-card">
            <div className="title">{REQUEST_TYPE_TH[r.request_type]}</div>
            <p className="field-hint">ยื่นเมื่อ {thaiDate(r.received_at)} · สถานะ: {REQUEST_STATUS_TH[r.status]}</p>
            {r.decision_note && <p>หมายเหตุจากเจ้าหน้าที่: {r.decision_note}</p>}
            {r.export_id && r.status === 'completed' && <p><Link to="/exports">ดาวน์โหลดไฟล์ข้อมูลที่หน้า “ส่งออก”</Link></p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
