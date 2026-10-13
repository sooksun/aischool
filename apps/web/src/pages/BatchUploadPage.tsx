// FR-014: drop several files at once; each becomes its own evidence item in the
// chosen category, with progress per file. Bytes go through the same resumable
// upload sessions as the single-file wizard, so a failed file is retried from
// the parts the server already has, and a replay never makes a second item
// (Idempotency-Key per file, kept for the life of the page).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';
import { readVideoDurationSeconds, sha256Hex, validateDuration, validateFileAgainstCategory } from '../lib/fileValidation';
import { sendUploadBytes } from '../lib/uploadWithProgress';
import { newEntries, runBatch, type BatchEntry, type BatchStage } from '../lib/batchUpload';

type EvidenceCategory = components['schemas']['EvidenceCategory'];

const STAGE_LABEL: Record<BatchStage, string> = {
  waiting: 'รอส่ง', hashing: 'กำลังเตรียม', uploading: 'กำลังส่ง', confirming: 'กำลังยืนยัน', done: 'ส่งแล้ว', failed: 'ส่งไม่สำเร็จ',
};

export function BatchUploadPage() {
  const [categories, setCategories] = useState<EvidenceCategory[] | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [entries, setEntries] = useState<BatchEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const keys = useRef(new Map<string, { clientUuid: string; evidenceKey: string; uploadKey: string; uploadId?: string }>());

  useEffect(() => {
    api.GET('/evidence-categories', {}).then((res) => setCategories(unwrap(res))).catch(() => setCategories([]));
  }, []);
  const category = categories?.find((c) => c.id === categoryId) ?? null;

  function add(files: FileList | null) {
    if (!files) return;
    // Copy now: a FileList is live, and clearing the input empties it before
    // the state updater runs.
    const picked = Array.from(files);
    setEntries((prev) => [...prev, ...newEntries(picked, prev)]);
  }

  async function uploadOne(entry: BatchEntry, update: (p: Partial<BatchEntry>) => void) {
    if (!category) throw new Error('เลือกประเภทหลักฐานก่อน');
    const check = validateFileAgainstCategory(entry.file, category);
    if (!check.ok) throw new Error(check.messageTh!);
    let k = keys.current.get(entry.key);
    if (!k) {
      k = { clientUuid: crypto.randomUUID(), evidenceKey: crypto.randomUUID(), uploadKey: crypto.randomUUID() };
      keys.current.set(entry.key, k);
    }

    update({ stage: 'hashing' });
    const seconds = entry.file.type.startsWith('video/') ? await readVideoDurationSeconds(entry.file) : null;
    const durationCheck = validateDuration(seconds, category);
    if (!durationCheck.ok) throw new Error(durationCheck.messageTh!);
    const checksum = await sha256Hex(entry.file);
    if (!entry.evidenceId) {
      const dups = unwrap(await api.GET('/me/files/duplicates', { params: { query: { checksum_sha256: checksum } } }));
      update({ duplicateOf: dups.map((d) => ({ evidenceId: d.evidence_id, title: d.title })) });
    }

    const evidenceId = entry.evidenceId ?? unwrap(await api.POST('/evidence', {
      params: { header: { 'Idempotency-Key': k.evidenceKey } },
      body: {
        category_id: category.id, title: entry.file.name.replace(/\.[^.]+$/, '') || entry.file.name, kind: 'file',
        contains_learners: 'unknown', client_uuid: k.clientUuid,
      },
    })).id;
    update({ evidenceId });

    // Current state from the server (parts_received), so a retry resumes.
    let session = k.uploadId ? unwrap(await api.GET('/uploads/{uploadId}', { params: { path: { uploadId: k.uploadId } } })) : null;
    if (!session || session.status === 'expired' || session.status === 'aborted') {
      if (session) k.uploadKey = crypto.randomUUID();
      session = unwrap(await api.POST('/uploads', {
        params: { header: { 'Idempotency-Key': k.uploadKey } },
        body: {
          evidence_id: evidenceId, filename: entry.file.name, content_type: entry.file.type, byte_size: entry.file.size,
          checksum_sha256: checksum, duration_ms: seconds === null ? null : Math.round(seconds * 1000),
        },
      }));
      k.uploadId = session.id;
    }
    if (session.status !== 'completed') {
      update({ stage: 'uploading' });
      await sendUploadBytes(session, entry.file, (fraction) => update({ progress: fraction }));
      update({ stage: 'confirming' });
      unwrap(await api.POST('/uploads/{uploadId}/complete', {
        params: { path: { uploadId: session.id } }, body: { part_count: session.part_count },
      }));
    }
  }

  async function start() {
    setRunning(true);
    try {
      await runBatch(entries, (e, u) => uploadOne(e, u).catch((err) => {
        throw new Error(err instanceof ApiError ? thaiMessageFor(err) : err instanceof Error ? err.message : 'ส่งไม่สำเร็จ');
      }), setEntries);
    } finally {
      setRunning(false);
    }
  }

  const pending = entries.filter((e) => e.stage === 'waiting' || e.stage === 'failed').length;

  return (
    <main className="page">
      <h1>ส่งหลักฐานหลายไฟล์</h1>
      <p className="field-hint">แต่ละไฟล์จะเป็นหลักฐาน 1 ชิ้น ตั้งชื่อตามชื่อไฟล์ แก้ชื่อและจับคู่ตัวชี้วัดได้ภายหลังที่หน้าหลักฐาน</p>

      <div className="field">
        <label htmlFor="batch-category">ประเภทหลักฐาน</label>
        <select id="batch-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={running}>
          <option value="">เลือกประเภท</option>
          {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.label_th}</option>)}
        </select>
      </div>

      <div
        className={`dropzone${dragOver ? ' active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); add(e.dataTransfer.files); }}
      >
        <label htmlFor="batch-files">ลากไฟล์มาวางที่นี่ หรือเลือกไฟล์</label>
        <input id="batch-files" type="file" multiple onChange={(e) => { add(e.target.files); e.target.value = ''; }} disabled={running} />
      </div>

      <ul style={{ listStyle: 'none', padding: 0 }} aria-label="ไฟล์ที่จะส่ง">
        {entries.map((e) => (
          <li key={e.key} className="evidence-card">
            <div className="title">{e.file.name}</div>
            <span className="field-hint">{(e.file.size / (1024 * 1024)).toFixed(1)} MB · {STAGE_LABEL[e.stage]}</span>
            {(e.stage === 'uploading' || e.stage === 'confirming') && (
              <div className="progress-bar" role="progressbar" aria-label={e.file.name} aria-valuenow={Math.round(e.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${Math.round(e.progress * 100)}%` }} />
              </div>
            )}
            {e.duplicateOf.length > 0 && (
              <p className="field-hint" role="note">
                ไฟล์นี้มีอยู่แล้วใน {e.duplicateOf.map((d, i) => (
                  <span key={d.evidenceId}>{i > 0 && ', '}<Link to={`/evidence/${d.evidenceId}`}>“{d.title}”</Link></span>
                ))}
              </p>
            )}
            {e.error && <div className="field-error" role="alert">{e.error}</div>}
            {e.stage === 'done' && e.evidenceId && <Link to={`/evidence/${e.evidenceId}`}>เปิดหลักฐาน</Link>}
            {!running && e.stage === 'waiting' && (
              <button type="button" className="btn btn-secondary" onClick={() => setEntries((prev) => prev.filter((x) => x.key !== e.key))}>เอาออก</button>
            )}
          </li>
        ))}
      </ul>

      <div className="action-bar">
        <Link to="/" className="btn btn-secondary">กลับ</Link>
        <button type="button" className="btn btn-primary" onClick={start} disabled={running || !category || pending === 0}>
          {running ? 'กำลังส่ง…' : entries.some((e) => e.stage === 'failed') ? `ลองส่งใหม่ (${pending})` : `ส่ง ${pending} ไฟล์`}
        </button>
      </div>
    </main>
  );
}
