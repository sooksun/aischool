// S1 per docs/architecture/ux/evidence-submission-flow.md — "หลักฐานของฉัน"
// Scan badges use Evidence.scan_status from list API (CCR-009) — no N+1 detail fetches.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { ProfileConfirmBanner } from '../components/ProfileConfirmBanner';
import type { components, operations } from '../api/schema.generated';

type Evidence = components['schemas']['Evidence'];
type ScanStatus = components['schemas']['ScanStatus'];
type ListQuery = NonNullable<operations['listEvidence']['parameters']['query']>;

// FR-054: search and filter the portfolio. Empty values are left out of the query.
interface Filters { q: string; kind: '' | 'file' | 'link' | 'note'; mapping: '' | 'unmapped' | 'owner_confirmed' | 'validated' | 'returned'; from: string; to: string }
const NO_FILTERS: Filters = { q: '', kind: '', mapping: '', from: '', to: '' };
const MAPPING_TH: Record<Exclude<Filters['mapping'], ''>, string> = {
  unmapped: 'ยังไม่ผูกตัวชี้วัด', owner_confirmed: 'รอรับรอง', validated: 'รับรองแล้ว', returned: 'ถูกส่งกลับ',
};

export function EvidenceListPage() {
  const { user, logout, capabilities } = useAuth();
  const { submitEvidence } = capabilities;
  const [items, setItems] = useState<Evidence[] | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  const load = useCallback(async () => {
    try {
      const query: ListQuery = { page: 1, page_size: 20 };
      if (filters.q.trim()) query.q = filters.q.trim();
      if (filters.kind) query.kind = filters.kind;
      if (filters.mapping) query.mapping_state = filters.mapping;
      if (filters.from) query.performed_from = filters.from;
      if (filters.to) query.performed_to = filters.to;
      const page = unwrap(await api.GET('/evidence', { params: { query } }));
      setItems(page.items);
      setError(false);
    } catch {
      setError(true);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-poll list while any row is still pending scan (single list call — no N+1).
  useEffect(() => {
    if (!items?.some((i) => i.scan_status === 'pending')) return;
    const t = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(t);
  }, [items, load]);

  return (
    <main className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>หลักฐานของฉัน</h1>
        <button type="button" className="btn btn-secondary" onClick={logout}>ออกจากระบบ</button>
      </div>
      {user?.display_name && <p className="field-hint">{user.display_name}</p>}
      {user?.personnel && <ProfileConfirmBanner key={user.personnel.id} personnel={user.personnel} />}

      <form
        className="card"
        aria-label="ค้นหาและกรองหลักฐาน"
        onSubmit={(e) => { e.preventDefault(); setFilters(draft); }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}
      >
        <label className="field">ค้นหาชื่อ
          <input type="search" value={draft.q} maxLength={100} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </label>
        <label className="field">ประเภท
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Filters['kind'] })}>
            <option value="">ทั้งหมด</option><option value="file">ไฟล์</option><option value="link">ลิงก์</option><option value="note">บันทึก</option>
          </select>
        </label>
        <label className="field">การผูกตัวชี้วัด
          <select value={draft.mapping} onChange={(e) => setDraft({ ...draft, mapping: e.target.value as Filters['mapping'] })}>
            <option value="">ทั้งหมด</option>
            {(Object.keys(MAPPING_TH) as (keyof typeof MAPPING_TH)[]).map((k) => <option key={k} value={k}>{MAPPING_TH[k]}</option>)}
          </select>
        </label>
        <label className="field">ปฏิบัติงานตั้งแต่
          <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label className="field">ถึง
          <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <button type="submit" className="btn btn-secondary">ค้นหา</button>
        {filtered && <button type="button" className="btn" onClick={() => { setDraft(NO_FILTERS); setFilters(NO_FILTERS); }}>ล้างตัวกรอง</button>}
      </form>

      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>โหลดรายการหลักฐานไม่สำเร็จ กรุณาลองใหม่</span>
        </div>
      )}

      {items === null && !error && (
        <div aria-live="polite" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="evidence-card" aria-hidden="true" style={{ opacity: 0.5 }}>
              <div className="title">กำลังโหลด…</div>
            </div>
          ))}
        </div>
      )}

      {items !== null && items.length === 0 && filtered && (
        <p className="field-hint" role="status">ไม่พบหลักฐานที่ตรงกับตัวกรอง</p>
      )}

      {items !== null && items.length === 0 && !filtered && (
        <div className="empty-state">
          <p>ยังไม่มีหลักฐาน</p>
          {submitEvidence ? (
            <>
              {/* This used to read "แตะปุ่ม + เพื่อส่ง…" while offering no button —
                  it described the floating '+', whose only label is an aria-label.
                  A first-time teacher landed on an empty screen with nothing to
                  press. The call to action is now the thing itself. */}
              <p className="field-hint">รองรับไฟล์ PDF รูปภาพ และวิดีโอ</p>
              <p>
                <Link to="/evidence/new" className="btn btn-primary">+ ส่งหลักฐานชิ้นแรก</Link>
              </p>
            </>
          ) : (
            <p className="field-hint">ยังไม่มีหลักฐานที่คุณเข้าถึงได้</p>
          )}
        </div>
      )}

      {items !== null && items.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((ev) => (
            <li key={ev.id}>
              <Link to={`/evidence/${ev.id}`} className="evidence-card">
                <div className="title">{ev.title}</div>
                <span className="status-badge" style={{ marginRight: 8 }}>
                  <span className="status-dot" data-state={ev.status === 'active' ? 'clean' : 'pending'} aria-hidden="true" />
                  {statusLabel(ev.status)}
                </span>
                {ev.scan_status && (
                  <span className="status-badge">
                    <span className="status-dot" data-state={ev.scan_status} aria-hidden="true" />
                    {scanStatusLabel(ev.scan_status)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Gated like the nav entry: an evaluator reaches this list through a
          committee grant but holds no createEvidence grant, so the FAB would be
          a dead end for them. */}
      {submitEvidence && (
        <Link to="/evidence/new" className="fab" aria-label="ส่งหลักฐานใหม่">+</Link>
      )}
    </main>
  );
}

function statusLabel(status: Evidence['status']): string {
  switch (status) {
    case 'draft': return 'ร่าง';
    case 'active': return 'ส่งแล้ว';
    case 'archived': return 'จัดเก็บแล้ว';
    case 'rejected': return 'ถูกปฏิเสธ';
    default: return status;
  }
}

function scanStatusLabel(status: ScanStatus): string {
  switch (status) {
    case 'pending': return 'กำลังสแกน';
    case 'clean': return 'ปลอดภัย';
    // CCR-012: no scanner ran, so this must not read as a safety verdict —
    // 'ปลอดภัย' would be the exact claim the platform is not entitled to make.
    case 'unscanned': return 'ยังไม่ได้สแกน';
    case 'blocked': return 'ถูกกัก';
    default: return status;
  }
}
