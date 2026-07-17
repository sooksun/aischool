// S1 per docs/architecture/ux/evidence-submission-flow.md — "หลักฐานของฉัน"
// SEIP-UI-003b: surface file scan_status (poll detail for active rows) + status badges.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import type { components } from '../api/schema.generated';

type Evidence = components['schemas']['Evidence'];
type ScanStatus = components['schemas']['ScanStatus'];

interface ListRow extends Evidence {
  /** Aggregated from detail files when loaded: worst-of pending > blocked > clean. */
  scan_status?: ScanStatus | 'none';
}

export function EvidenceListPage() {
  const { user, logout } = useAuth();
  const [items, setItems] = useState<ListRow[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = unwrap(await api.GET('/evidence', {
        params: { query: { page: 1, page_size: 20 } },
      }));
      const base = page.items as ListRow[];
      // Enrich with scan_status from detail (list DTO has no files). Cap parallel.
      const enriched = await Promise.all(base.map(async (ev) => {
        try {
          const d = unwrap(await api.GET('/evidence/{evidenceId}', {
            params: { path: { evidenceId: ev.id } },
          }));
          const files = d.files ?? [];
          if (files.length === 0) return { ...ev, scan_status: 'none' as const };
          if (files.some((f) => f.scan_status === 'pending')) {
            return { ...ev, scan_status: 'pending' as const };
          }
          if (files.some((f) => f.scan_status === 'blocked')) {
            return { ...ev, scan_status: 'blocked' as const };
          }
          return { ...ev, scan_status: 'clean' as const };
        } catch {
          return { ...ev, scan_status: undefined };
        }
      }));
      setItems(enriched);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-poll list while any row is still pending scan.
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
                <span className="status-badge" style={{ marginRight: 8 }}>
                  <span className="status-dot" data-state={ev.status === 'active' ? 'clean' : 'pending'} aria-hidden="true" />
                  {statusLabel(ev.status)}
                </span>
                {ev.scan_status && ev.scan_status !== 'none' && (
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

function scanStatusLabel(status: ScanStatus | 'none'): string {
  switch (status) {
    case 'pending': return 'กำลังสแกน';
    case 'clean': return 'ปลอดภัย';
    case 'blocked': return 'ถูกกัก';
    default: return '';
  }
}
