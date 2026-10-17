// FR-093: the person's sessions — each phone or tablet signed in to the app and
// each browser — and signing one out. Signing out this browser ends the page too.
import { useEffect, useState } from 'react';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';

type DeviceSession = components['schemas']['DeviceSession'];

const PLATFORM_LABEL: Record<DeviceSession['platform'], string> = {
  web: 'เว็บเบราว์เซอร์', android: 'แอป Android', ios: 'แอป iPhone/iPad',
};
const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

export function DevicesPage() {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.GET('/devices')
      .then((res) => setSessions(unwrap(res)))
      .catch((e) => setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดรายการอุปกรณ์ไม่สำเร็จ'));
  }
  useEffect(reload, []);

  async function revoke(s: DeviceSession) {
    const what = s.current ? 'ออกจากระบบในเบราว์เซอร์นี้' : `ออกจากระบบ ${PLATFORM_LABEL[s.platform]} เครื่องนี้`;
    if (!window.confirm(`${what}?`)) return;
    setError(null);
    try {
      unwrap(await api.DELETE('/devices/{deviceSessionId}', { params: { path: { deviceSessionId: s.id } } }));
      if (s.current) window.location.assign('/login');
      else reload();
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'ออกจากระบบอุปกรณ์ไม่สำเร็จ');
    }
  }

  return (
    <main className="page">
      <h1>อุปกรณ์ที่เข้าสู่ระบบ</h1>
      <p>หากพบอุปกรณ์ที่ไม่รู้จัก หรือทำโทรศัพท์หาย ให้กดออกจากระบบเครื่องนั้น แอปบนเครื่องนั้นจะลบข้อมูลในเครื่องเมื่อเชื่อมต่อครั้งถัดไป</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {sessions === null ? <p>กำลังโหลด…</p> : (
        <ul className="list" aria-label="อุปกรณ์">
          {sessions.map((s) => (
            <li key={s.id}>
              <strong>{PLATFORM_LABEL[s.platform]}</strong>
              {s.app_version && <> · เวอร์ชัน {s.app_version}</>}
              {s.current && <> · <em>เครื่องนี้</em></>}
              <div>เข้าสู่ระบบ {when(s.created_at)} · ใช้งานล่าสุด {when(s.last_seen_at)}</div>
              <button type="button" className="btn" onClick={() => revoke(s)}>ออกจากระบบเครื่องนี้</button>
            </li>
          ))}
          {sessions.length === 0 && <li>ไม่มีอุปกรณ์อื่นที่เข้าสู่ระบบด้วย SEIP ID</li>}
        </ul>
      )}
    </main>
  );
}
