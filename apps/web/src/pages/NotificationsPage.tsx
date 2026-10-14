// P4 (FR-102): the in-app inbox and channel settings. Opening a notification
// marks it read and goes to its route (always an in-app path).
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';

type Notification = components['schemas']['Notification'];
type Prefs = components['schemas']['NotificationPreferences'];

export function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(unwrap(await api.GET('/notifications', { params: { query: { limit: 50 } } })).items);
      setPrefs(unwrap(await api.GET('/notification-preferences', {})));
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดไม่สำเร็จ');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function open(n: Notification) {
    if (!n.read_at) await api.POST('/notifications/read', { body: { all: false, ids: [n.id] } }).catch(() => {});
    window.dispatchEvent(new Event('seip:notifications'));
    // Only in-app paths are followed — never a URL from elsewhere.
    if (n.route?.startsWith('/') && !n.route.startsWith('//')) navigate(n.route);
    else void load();
  }

  async function readAll() {
    await api.POST('/notifications/read', { body: { all: true } }).catch(() => {});
    window.dispatchEvent(new Event('seip:notifications'));
    await load();
  }

  async function savePrefs(next: Prefs) {
    setPrefs(next);
    try {
      setPrefs(unwrap(await api.PUT('/notification-preferences', { body: next })));
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'บันทึกไม่สำเร็จ');
    }
  }

  return (
    <main className="page">
      <h1>การแจ้งเตือน</h1>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {items !== null && items.length === 0 && <p className="field-hint">ยังไม่มีการแจ้งเตือน</p>}
      {items !== null && items.some((n) => !n.read_at) && (
        <button type="button" className="btn btn-secondary" onClick={() => void readAll()}>อ่านทั้งหมดแล้ว</button>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }} aria-label="รายการแจ้งเตือน">
        {(items ?? []).map((n) => (
          <li key={n.id}>
            <button type="button" className="evidence-card" style={{ width: '100%', textAlign: 'left', fontWeight: n.read_at ? 'normal' : 'bold' }} onClick={() => void open(n)}>
              <div className="title">{n.read_at ? '' : '● '}{n.title_th}</div>
              {n.body_th && <p className="field-hint">{n.body_th}</p>}
              <p className="field-hint">{new Date(n.created_at).toLocaleString('th-TH')}</p>
            </button>
          </li>
        ))}
      </ul>
      {prefs && (
        <section aria-label="ตั้งค่าการแจ้งเตือน">
          <h2>ตั้งค่า</h2>
          <label className="field"><input type="checkbox" checked={prefs.push} onChange={(e) => void savePrefs({ ...prefs, push: e.target.checked })} /> แจ้งเตือนในแอปมือถือ</label>
          <label className="field"><input type="checkbox" checked={prefs.email} onChange={(e) => void savePrefs({ ...prefs, email: e.target.checked })} /> ส่งทางอีเมล</label>
          <p className="field-hint">การแจ้งเตือนทางมือถือไม่มีเนื้อหาของหลักฐานเลย มีแค่สัญญาณให้แอปมาดึงข้อมูลเอง</p>
        </section>
      )}
    </main>
  );
}

/** Unread count for the nav, refreshed every minute and when the inbox changes. */
export function useUnreadNotifications(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const tick = () => api.GET('/notifications', { params: { query: { unread: true, limit: 1 } } })
      .then((r) => { if (live && r.data) setCount(r.data.unread_count); })
      .catch(() => {});
    void tick();
    const t = setInterval(tick, 60_000);
    window.addEventListener('seip:notifications', tick);
    return () => { live = false; clearInterval(t); window.removeEventListener('seip:notifications', tick); };
  }, [enabled]);
  return count;
}
