// S1 per docs/architecture/ux/evidence-submission-flow.md — "หลักฐานของฉัน"
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import type { components } from '../api/schema.generated';

type Evidence = components['schemas']['Evidence'];

export function EvidenceListPage() {
  const { user, logout } = useAuth();
  const [items, setItems] = useState<Evidence[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.GET('/evidence', { params: { query: { page: 1, page_size: 20 } } })
      .then((res) => { if (!cancelled) setItems(unwrap(res).items); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>หลักฐานของฉัน</h1>
        <button type="button" className="btn btn-secondary" onClick={logout}>ออกจากระบบ</button>
      </div>
      {user?.display_name && <p className="field-hint">{user.display_name}</p>}

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

      {items !== null && items.length === 0 && (
        <div className="empty-state">
          <p>ยังไม่มีหลักฐาน</p>
          <p className="field-hint">แตะปุ่ม + เพื่อส่งหลักฐานชิ้นแรกของคุณ</p>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((ev) => (
            <li key={ev.id}>
              <Link to={`/evidence/${ev.id}`} className="evidence-card">
                <div className="title">{ev.title}</div>
                <span className="status-badge">
                  <span className="status-dot" data-state={ev.status === 'active' ? 'clean' : 'pending'} aria-hidden="true" />
                  {statusLabel(ev.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link to="/evidence/new" className="fab" aria-label="ส่งหลักฐานใหม่">+</Link>
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
