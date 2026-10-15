// FR-117 (CCR-029): the DPO's queue — every request of their สพท., soonest due
// first. Approving a copy (access / portability) builds the person's portfolio
// export; other types are carried out by hand, then completed with a note. A
// decision needs the second factor (step-up); the banner offers it.
import { useCallback, useEffect, useState } from 'react';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import {
  REQUEST_STATUS_TH, REQUEST_TYPE_TH, thaiDate, type SubjectRequest, type SubjectRequestStatus,
} from '../../lib/subject-requests';

const FILTERS: { value: SubjectRequestStatus | 'all'; label: string }[] = [
  { value: 'received', label: 'รอพิจารณา' },
  { value: 'approved', label: 'อนุมัติแล้ว รอดำเนินการ' },
  { value: 'fulfilling', label: 'กำลังจัดทำไฟล์' },
  { value: 'all', label: 'ทั้งหมด' },
];

type Action = 'approve' | 'reject' | 'complete';

export function DpoRequestsPage() {
  const [filter, setFilter] = useState<SubjectRequestStatus | 'all'>('received');
  const [items, setItems] = useState<SubjectRequest[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = filter === 'all' ? { limit: 100 } : { status: filter, limit: 100 };
      setItems(unwrap(await api.GET('/subject-requests', { params: { query } })).items);
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดไม่สำเร็จ');
    }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  async function decide(r: SubjectRequest, action: Action) {
    setError(null);
    try {
      unwrap(await api.POST('/subject-requests/{requestId}/decision', {
        params: { path: { requestId: r.id } },
        body: { action, note: notes[r.id]?.trim() || null },
      }));
      setNotes((n) => ({ ...n, [r.id]: '' }));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'บันทึกไม่สำเร็จ');
    }
  }

  return (
    <main className="page">
      <h1>คำขอใช้สิทธิของเจ้าของข้อมูล</h1>
      <p className="field-hint">กำหนดตอบ 30 วันนับจากวันรับคำขอ (ตัวเลขนี้ยังไม่ได้ยืนยันกับนักกฎหมาย — ใช้เป็นคำเตือน)</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div role="radiogroup" aria-label="สถานะ">
        {FILTERS.map((f) => (
          <label key={f.value} style={{ marginRight: 12 }}>
            <input type="radio" name="dsr-filter" checked={filter === f.value} onChange={() => setFilter(f.value)} /> {f.label}
          </label>
        ))}
      </div>
      {items !== null && items.length === 0 && <p className="field-hint">ไม่มีคำขอในสถานะนี้</p>}
      <ul style={{ listStyle: 'none', padding: 0 }} aria-label="คำขอ">
        {(items ?? []).map((r) => (
          <li key={r.id} className="evidence-card">
            <div className="title">
              {REQUEST_TYPE_TH[r.request_type]} — {r.requester_display_name}
              {r.overdue && <strong style={{ color: 'var(--danger, #b00020)' }}> · เกินกำหนด</strong>}
            </div>
            <p className="field-hint">
              รับเมื่อ {thaiDate(r.received_at)} · กำหนด {thaiDate(r.due_at)} · {REQUEST_STATUS_TH[r.status]}
            </p>
            {r.details && <p>{r.details}</p>}
            {r.decision_note && <p className="field-hint">บันทึก: {r.decision_note}</p>}
            {(r.status === 'received' || r.status === 'approved') && (
              <>
                <label className="field">
                  หมายเหตุ / เหตุผล
                  <textarea rows={2} maxLength={2000} value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                </label>
                {r.status === 'received' && (
                  <button type="button" className="btn btn-primary" onClick={() => void decide(r, 'approve')}>
                    {r.request_type === 'access' || r.request_type === 'portability' ? 'อนุมัติและจัดทำไฟล์ข้อมูล' : 'อนุมัติ'}
                  </button>
                )}
                {r.status === 'approved' && (
                  <button type="button" className="btn btn-primary" onClick={() => void decide(r, 'complete')}>ดำเนินการแล้ว ปิดคำขอ</button>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => void decide(r, 'reject')}>ไม่อนุมัติ</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
