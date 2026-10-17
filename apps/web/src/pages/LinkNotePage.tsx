// FR-015: evidence that is a link (YouTube, Google Drive, …) or a written note
// — no bytes, so no upload. It is active at once and maps and reuses like a
// file. SEIP stores the address only; the linked content is never fetched.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';

type EvidenceCategory = components['schemas']['EvidenceCategory'];

/** http(s) only — what the server accepts. */
export function isWebAddress(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function LinkNotePage() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<'link' | 'note'>('link');
  const [categories, setCategories] = useState<EvidenceCategory[] | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per form, kept across retries: a lost response never makes a second item.
  const ids = useRef({ clientUuid: crypto.randomUUID(), key: crypto.randomUUID() });

  useEffect(() => {
    api.GET('/evidence-categories', {}).then((res) => {
      const list = unwrap(res);
      setCategories(list);
      if (list[0]) setCategoryId(list[0].id);
    }).catch(() => setCategories([]));
  }, []);

  async function save() {
    if (!title.trim()) return setError('กรุณาระบุชื่อหลักฐาน');
    if (kind === 'link' && !isWebAddress(url)) return setError('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
    if (kind === 'note' && !text.trim()) return setError('กรุณาพิมพ์บันทึก');
    setError(null);
    setBusy(true);
    try {
      const ev = unwrap(await api.POST('/evidence', {
        params: { header: { 'Idempotency-Key': ids.current.key } },
        body: {
          category_id: categoryId, title: title.trim(), kind, client_uuid: ids.current.clientUuid, contains_learners: 'unknown',
          ...(kind === 'link' ? { link_url: url.trim() } : { note_text: text.trim() }),
        },
      }));
      navigate(`/evidence/${ev.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? thaiMessageFor(err) : 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <h1>เพิ่มลิงก์หรือบันทึก</h1>
      <div className="chip-list" role="radiogroup" aria-label="ชนิดหลักฐาน">
        <button type="button" className="chip" role="radio" aria-checked={kind === 'link'} onClick={() => setKind('link')}>ลิงก์</button>
        <button type="button" className="chip" role="radio" aria-checked={kind === 'note'} onClick={() => setKind('note')}>บันทึกข้อความ</button>
      </div>
      <div className="field">
        <label htmlFor="ln-category">หมวดหลักฐาน</label>
        <select id="ln-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!categories?.length}>
          {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.label_th}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ln-title">ชื่อหลักฐาน</label>
        <input id="ln-title" type="text" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      {kind === 'link' ? (
        <div className="field">
          <label htmlFor="ln-url">ลิงก์</label>
          <input id="ln-url" type="url" inputMode="url" maxLength={2000} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          <p className="field-hint">ระบบเก็บเฉพาะลิงก์ ไม่ได้ดึงเนื้อหาจากลิงก์มาเก็บหรือวิเคราะห์ — ตรวจให้แน่ใจว่ากรรมการเปิดดูได้</p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="ln-text">บันทึก</label>
          <textarea id="ln-text" rows={8} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      {error && <div className="field-error" role="alert">{error}</div>}
      <div className="action-bar">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>ยกเลิก</button>
        <button type="button" className="btn btn-primary" disabled={busy || !categoryId} onClick={() => void save()}>
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </main>
  );
}
