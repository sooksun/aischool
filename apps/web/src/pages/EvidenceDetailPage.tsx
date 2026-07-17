// S7 (done screen, revisited) + ongoing detail view — per evidence-submission-flow.md
// "S7 ส่งแล้ว: การ์ดสรุป + สถานะสแกน + ปุ่มผูกตัวชี้วัดเพิ่ม"
// AI suggest (SEIP-UI-005): local_heuristic proposals require human confirm.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';
import { useAuth, hasRole } from '../hooks/useAuth';

type EvidenceDetail = components['schemas']['Evidence'] & {
  files: components['schemas']['EvidenceFile'][];
  mappings: components['schemas']['Mapping'][];
};
type Mapping = components['schemas']['Mapping'];
type Framework = components['schemas']['Framework'];

export function EvidenceDetailPage() {
  const { user } = useAuth();
  const canGovernMappings = user ? hasRole(user, ['director', 'school_admin']) : false;
  const { evidenceId } = useParams<{ evidenceId: string }>();
  const [evidence, setEvidence] = useState<EvidenceDetail | null>(null);
  const [error, setError] = useState(false);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [frameworkId, setFrameworkId] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!evidenceId) return Promise.resolve();
    return api.GET('/evidence/{evidenceId}', { params: { path: { evidenceId } } })
      .then((res) => {
        setEvidence(unwrap(res) as EvidenceDetail);
        setError(false);
      })
      .catch(() => setError(true));
  }, [evidenceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Poll while any file is still scanning so download appears when worker marks clean.
  useEffect(() => {
    if (!evidence) return;
    const pending = evidence.files.some((f) => f.scan_status === 'pending');
    if (!pending) return;
    const t = setInterval(() => { void reload(); }, 3000);
    return () => clearInterval(t);
  }, [evidence, reload]);

  useEffect(() => {
    api.GET('/frameworks', {})
      .then((res) => {
        const list = unwrap(res);
        setFrameworks(list);
        if (list[0]) setFrameworkId(list[0].id);
      })
      .catch(() => setFrameworks([]));
  }, []);

  async function onSuggest() {
    if (!evidenceId || !frameworkId) return;
    setSuggesting(true);
    setSuggestMsg(null);
    setSuggestErr(null);
    try {
      const result = unwrap(await api.POST('/evidence/{evidenceId}/mappings/suggest', {
        params: { path: { evidenceId } },
        body: { framework_version_id: frameworkId, max_suggestions: 5 },
      }));
      setSuggestMsg(
        result.items.length === 0
          ? 'ไม่พบคำแนะนำที่ตรงพอ — ลองปรับชื่อ/คำอธิบายหลักฐาน หรือผูกด้วยมือ'
          : `ระบบแนะนำ ${result.items.length} ตัวชี้วัด (ต้องยืนยันก่อนใช้งาน) · ข้ามที่ผูกแล้ว ${result.skipped_active ?? 0}`,
      );
      reload();
    } catch (err) {
      setSuggestErr(err instanceof ApiError ? thaiMessageFor(err) : 'แนะนำตัวชี้วัดไม่สำเร็จ');
    } finally {
      setSuggesting(false);
    }
  }

  async function act(mappingId: string, action: 'confirm' | 'reject' | 'revoke') {
    setActingId(mappingId);
    setSuggestErr(null);
    try {
      await unwrap(await api.PATCH('/mappings/{mappingId}', {
        params: { path: { mappingId } },
        body: { action },
      }));
      reload();
    } catch (err) {
      setSuggestErr(err instanceof ApiError ? thaiMessageFor(err) : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setActingId(null);
    }
  }

  // CCR-010: presign only on user click — getEvidence never embeds download_url.
  async function downloadFile(fileId: string, filename: string) {
    if (!evidenceId) return;
    setDownloadBusyId(fileId);
    setDownloadErr(null);
    try {
      const { download_url } = unwrap(await api.GET(
        '/evidence/{evidenceId}/files/{fileId}/download-url',
        { params: { path: { evidenceId, fileId } } },
      ));
      const a = document.createElement('a');
      a.href = download_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.download = filename;
      a.click();
    } catch (err) {
      setDownloadErr(err instanceof ApiError ? thaiMessageFor(err) : 'ดาวน์โหลดไม่สำเร็จ');
    } finally {
      setDownloadBusyId(null);
    }
  }

  if (error) {
    return (
      <main className="page">
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>ไม่พบหลักฐานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง</span>
        </div>
        <Link to="/" className="btn btn-secondary">กลับหน้าหลัก</Link>
      </main>
    );
  }

  if (!evidence) {
    return <main className="page" aria-busy="true" aria-live="polite"><p>กำลังโหลด…</p></main>;
  }

  return (
    <main className="page">
      <Link to="/" className="field-hint">← กลับ</Link>
      <h1>{evidence.title}</h1>
      {evidence.description && <p>{evidence.description}</p>}

      <h2>ไฟล์</h2>
      {evidence.files.length === 0 && <p className="field-hint">ยังไม่มีไฟล์</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {evidence.files.map((f) => (
          <li key={f.id} className="evidence-card">
            <div className="title">{f.original_filename}</div>
            <span className="status-badge">
              <span className="status-dot" data-state={f.scan_status} aria-hidden="true" />
              {scanStatusLabel(f.scan_status)}
            </span>
            {f.scan_status === 'pending' && (
              <p className="field-hint">กำลังตรวจสอบความปลอดภัย — หน้านี้อัปเดตอัตโนมัติ</p>
            )}
            {f.scan_status === 'blocked' && (
              <p className="field-hint" role="alert">ไฟล์ถูกกักไว้ — ดาวน์โหลดไม่ได้ (UPL-006)</p>
            )}
            {f.scan_status === 'clean' && (
              <p style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={downloadBusyId === f.id}
                  onClick={() => void downloadFile(f.id, f.original_filename ?? 'download')}
                >
                  {downloadBusyId === f.id ? 'กำลังเตรียมลิงก์…' : 'ดาวน์โหลด'}
                </button>
              </p>
            )}
          </li>
        ))}
      </ul>
      {downloadErr && (
        <div className="alert alert-error" role="alert">{downloadErr}</div>
      )}

      <h2>ตัวชี้วัดที่ผูก</h2>
      {evidence.mappings.length === 0 && <p className="field-hint">ยังไม่ได้ผูกตัวชี้วัด</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {evidence.mappings.map((m) => (
          <li key={m.id} className="evidence-card" style={{ marginBottom: 8 }}>
            <div className="title">
              {mappingSourceLabel(m.mapping_source)} · {mappingStatusLabel(m.status)}
            </div>
            {m.rationale && <p className="field-hint">{m.rationale}</p>}
            {m.status === 'suggested' && canGovernMappings && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={actingId === m.id}
                  onClick={() => act(m.id, 'confirm')}
                >
                  ยืนยัน
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={actingId === m.id}
                  onClick={() => act(m.id, 'reject')}
                >
                  ปฏิเสธ
                </button>
              </div>
            )}
            {m.status === 'suggested' && !canGovernMappings && (
              <p className="field-hint">รอผู้บริหารยืนยันการผูกตัวชี้วัด</p>
            )}
          </li>
        ))}
      </ul>

      <h2>แนะนำตัวชี้วัดอัตโนมัติ</h2>
      <p className="field-hint">
        ใช้การจับคู่ข้อความในเครื่อง (local heuristic) — ไม่ส่งข้อมูลออกนอกระบบ · ต้องยืนยันด้วยมือเสมอ
      </p>
      <label className="field">
        <span>กรอบตัวชี้วัด</span>
        <select value={frameworkId} onChange={(e) => setFrameworkId(e.target.value)}>
          {frameworks.map((f) => (
            <option key={f.id} value={f.id}>{f.code}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-primary"
        disabled={suggesting || !frameworkId}
        onClick={onSuggest}
      >
        {suggesting ? 'กำลังวิเคราะห์…' : 'แนะนำตัวชี้วัด'}
      </button>
      {suggestMsg && <p className="field-hint" role="status">{suggestMsg}</p>}
      {suggestErr && (
        <div className="alert alert-error" role="alert">{suggestErr}</div>
      )}
    </main>
  );
}

function mappingSourceLabel(source: Mapping['mapping_source']): string {
  return source === 'ai_suggested' ? 'แนะนำอัตโนมัติ' : 'ผูกด้วยมือ';
}

function scanStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'กำลังตรวจสอบ';
    case 'clean': return 'ตรวจสอบแล้ว ปลอดภัย';
    case 'blocked': return 'ถูกกักไว้ — พบปัญหา';
    default: return status;
  }
}

function mappingStatusLabel(status: string): string {
  switch (status) {
    case 'suggested': return 'รอยืนยัน';
    case 'confirmed': return 'ยืนยันแล้ว';
    case 'rejected': return 'ถูกปฏิเสธ';
    case 'revoked': return 'ยกเลิกแล้ว';
    default: return status;
  }
}
