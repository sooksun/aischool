// P5 (ADR-0017): the person's portable portfolio — every accepted item's scanned
// originals plus a manifest, zipped by the worker. The download link is short
// and the package itself is gone after 7 days (it is a copy of personal data).
import { useCallback, useEffect, useState } from 'react';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';

type ExportPackage = components['schemas']['ExportPackage'];

const STATUS_TH: Record<ExportPackage['status'], string> = {
  queued: 'รอคิว',
  building: 'กำลังจัดทำ',
  ready: 'พร้อมดาวน์โหลด',
  failed: 'ไม่สำเร็จ',
  preflight_failed: 'ตรวจพบปัญหา',
  expired: 'หมดอายุแล้ว',
};

function size(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportsPage() {
  const [items, setItems] = useState<ExportPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(unwrap(await api.GET('/exports', { params: { query: { limit: 20 } } })).items);
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดไม่สำเร็จ');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Poll while something is still being built.
  const pending = (items ?? []).some((e) => e.status === 'queued' || e.status === 'building');
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      unwrap(await api.POST('/exports', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { kind: 'portfolio_portable' },
      }));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'ส่งคำขอไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function download(e: ExportPackage) {
    setError(null);
    try {
      const { download_url } = unwrap(await api.GET('/exports/{exportId}/download-url', { params: { path: { exportId: e.id } } }));
      window.location.assign(download_url);
    } catch (err) {
      setError(err instanceof ApiError ? thaiMessageFor(err) : 'ดาวน์โหลดไม่สำเร็จ');
      void load();
    }
  }

  return (
    <main className="page">
      <h1>ส่งออกแฟ้มผลงาน</h1>
      <p className="field-hint">
        รวมหลักฐานที่ผ่านการตรวจแล้วทั้งหมดของคุณเป็นไฟล์ ZIP เดียว (ไฟล์ต้นฉบับ + รายการ manifest.json)
        เพื่อเก็บไว้เองหรือนำไปใช้ที่อื่น ไฟล์จะถูกลบอัตโนมัติภายใน 7 วัน
      </p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <button type="button" className="btn btn-primary" disabled={busy || pending} onClick={() => void create()}>
        สร้างไฟล์ส่งออกแฟ้มผลงาน
      </button>
      {items !== null && items.length === 0 && <p className="field-hint">ยังไม่เคยส่งออก</p>}
      <ul style={{ listStyle: 'none', padding: 0 }} aria-label="รายการไฟล์ส่งออก">
        {(items ?? []).map((e) => (
          <li key={e.id} className="evidence-card">
            <div className="title">แฟ้มผลงาน · {new Date(e.created_at).toLocaleString('th-TH')}</div>
            <p className="field-hint">
              สถานะ: {STATUS_TH[e.status]}
              {e.status === 'ready' && e.byte_size ? ` · ${size(e.byte_size)}` : ''}
              {e.status === 'ready' && e.expires_at ? ` · ใช้ได้ถึง ${new Date(e.expires_at).toLocaleString('th-TH')}` : ''}
            </p>
            {e.status === 'ready' && (
              <button type="button" className="btn btn-secondary" onClick={() => void download(e)}>ดาวน์โหลด</button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
