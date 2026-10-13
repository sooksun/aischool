// S7 (done screen, revisited) + ongoing detail view — per evidence-submission-flow.md
// "S7 ส่งแล้ว: การ์ดสรุป + สถานะสแกน + ปุ่มผูกตัวชี้วัดเพิ่ม"
// Mappings are two-tier (ADR-0015, CCR-017): the owner confirms (and may revoke);
// the director or an assigned committee member validates or returns. AI
// suggestions arrive with the in-country analysis pipeline (P3) — there is no
// suggest button any more.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';
import { useAuth } from '../hooks/useAuth';

type EvidenceDetail = components['schemas']['Evidence'] & {
  files: components['schemas']['EvidenceFile'][];
  mappings: components['schemas']['Mapping'][];
};
type Mapping = components['schemas']['Mapping'];

export function EvidenceDetailPage() {
  const { user, capabilities, schools } = useAuth();
  const canValidateMappings = capabilities.governMappings;
  const { evidenceId } = useParams<{ evidenceId: string }>();
  const [evidence, setEvidence] = useState<EvidenceDetail | null>(null);
  const [error, setError] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const [returnNotes, setReturnNotes] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [ownerErr, setOwnerErr] = useState<string | null>(null);

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

  // CCR-024: the owner accepts an item uploaded on their behalf, or moves an item
  // to another of their schools (same สพท. only — the API says so otherwise).
  async function acceptItem() {
    if (!evidence) return;
    setOwnerErr(null);
    try {
      unwrap(await api.POST('/evidence/{evidenceId}/accept', { params: { path: { evidenceId: evidence.id } } }));
      await reload();
    } catch (e) {
      setOwnerErr(e instanceof ApiError ? thaiMessageFor(e) : 'บันทึกไม่สำเร็จ');
    }
  }
  async function moveTo(schoolId: string) {
    if (!evidence || schoolId === evidence.origin_school_id) return;
    setOwnerErr(null);
    try {
      unwrap(await api.PATCH('/evidence/{evidenceId}', {
        params: { path: { evidenceId: evidence.id }, header: { 'If-Match': `"${evidence.version}"` } },
        body: { origin_school_id: schoolId, contains_learners: evidence.contains_learners },
      }));
      await reload();
    } catch (e) {
      setOwnerErr(e instanceof ApiError ? thaiMessageFor(e) : 'ย้ายไม่สำเร็จ');
    }
  }

  async function act(mapping: Mapping, action: 'validate' | 'return' | 'revoke') {
    setActingId(mapping.id);
    setActErr(null);
    try {
      const returnNote = action === 'return' ? (returnNotes[mapping.id] ?? '').trim() : null;
      if (action === 'return' && !returnNote) {
        setActErr('กรุณาระบุเหตุผลที่ส่งกลับให้เจ้าของหลักฐาน');
        return;
      }
      unwrap(await api.PATCH('/mappings/{mappingId}', {
        // If-Match: the version this page last read — a change made meanwhile
        // (another validator, the owner revoking) comes back as RES-004.
        params: { path: { mappingId: mapping.id }, header: { 'If-Match': `"${mapping.version}"` } },
        body: { action, return_note: returnNote },
      }));
      await reload();
    } catch (err) {
      setActErr(err instanceof ApiError ? thaiMessageFor(err) : 'ดำเนินการไม่สำเร็จ');
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

  const isOwnItem = !!user?.person_id && evidence.owner_person_id === user.person_id;

  return (
    <main className="page">
      <Link to="/" className="field-hint">← กลับ</Link>
      <h1>{evidence.title}</h1>
      {evidence.description && <p>{evidence.description}</p>}

      {isOwnItem && !evidence.owner_accepted_at && (
        <div className="alert alert-info" role="region" aria-label="หลักฐานที่อัปโหลดแทน">
          <span>ผู้ดูแลระบบโรงเรียนอัปโหลดหลักฐานนี้แทนคุณ ตรวจดูแล้วกดยอมรับก่อนจึงจะนำไปจับคู่ตัวชี้วัดได้ ถ้าไม่ใช่ของคุณ ให้ลบทิ้ง</span>
          <button type="button" className="btn btn-primary" onClick={acceptItem}>ยอมรับเป็นหลักฐานของฉัน</button>
        </div>
      )}
      {isOwnItem && schools.length > 1 && (
        <div className="field">
          <label htmlFor="evidence-school">บันทึกในนามโรงเรียน</label>
          <select id="evidence-school" value={evidence.origin_school_id} onChange={(e) => void moveTo(e.target.value)}>
            {!schools.some((sc) => sc.id === evidence.origin_school_id) && <option value={evidence.origin_school_id}>โรงเรียนเดิม</option>}
            {schools.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
          </select>
        </div>
      )}
      {ownerErr && <div className="field-error" role="alert">{ownerErr}</div>}

      <h2>ไฟล์</h2>
      {evidence.files.length === 0 && <p className="field-hint">ยังไม่มีไฟล์</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {evidence.files.map((f) => (
          <li key={f.id} className="evidence-card">
            <div className="title">{f.original_filename}</div>
            {f.duplicate_of_evidence_id && (
              <p className="field-hint" role="note">
                ไฟล์นี้ตรงกับไฟล์ใน<Link to={`/evidence/${f.duplicate_of_evidence_id}`}>หลักฐานอีกชิ้นของคุณ</Link>ทุกไบต์
              </p>
            )}
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
            {f.scan_status === 'unscanned' && (
              <p className="field-hint">
                ระบบนี้ยังไม่ได้ติดตั้งโปรแกรมสแกนไวรัส — ดาวน์โหลดได้ แต่ยังไม่มีการตรวจไฟล์ กรุณาใช้ความระมัดระวัง
              </p>
            )}
            {(f.scan_status === 'clean' || f.scan_status === 'unscanned' || f.scan_status === 'sanitised') && f.media_state !== 'uploading' && (
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
        {evidence.mappings.map((m) => {
          // Only the owner ever confirms a mapping, so the confirming user is the owner.
          const mine = m.owner_confirmed_by_user_id === user?.id;
          const live = m.status !== 'revoked';
          return (
            <li key={m.id} className="evidence-card" style={{ marginBottom: 8 }}>
              <div className="title">
                {mappingSourceLabel(m.mapping_source)} · {mappingStatusLabel(m.status)}
              </div>
              {m.note && <p className="field-hint">{m.note}</p>}
              {m.status === 'returned' && m.return_note && (
                <p className="field-hint" role="note">ส่งกลับ: {m.return_note}</p>
              )}
              {mine && m.status === 'owner_confirmed' && (
                <p className="field-hint">รอผู้บริหารหรือกรรมการตรวจรับรอง</p>
              )}
              {!mine && canValidateMappings && m.status === 'owner_confirmed' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <label className="field">
                    <span>เหตุผล (กรณีส่งกลับ)</span>
                    <input
                      type="text" maxLength={1000} value={returnNotes[m.id] ?? ''}
                      onChange={(e) => setReturnNotes((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary" disabled={actingId === m.id} onClick={() => act(m, 'validate')}>
                      รับรอง
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={actingId === m.id} onClick={() => act(m, 'return')}>
                      ส่งกลับ
                    </button>
                  </div>
                </div>
              )}
              {mine && live && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-secondary" disabled={actingId === m.id} onClick={() => act(m, 'revoke')}>
                    ยกเลิกการผูก
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {actErr && (
        <div className="alert alert-error" role="alert">{actErr}</div>
      )}
    </main>
  );
}

function mappingSourceLabel(source: Mapping['mapping_source']): string {
  return source === 'ai_accepted' ? 'รับจากคำแนะนำ AI' : 'ผูกด้วยมือ';
}

function scanStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'กำลังตรวจสอบ';
    case 'clean': return 'ตรวจสอบแล้ว ปลอดภัย';
    // CCR-012: deliberately not 'ปลอดภัย' — no scanner ran, so the platform has
    // no basis for that claim. The file is still downloadable; this label is the
    // disclosure that goes with it.
    case 'unscanned': return 'ยังไม่ได้สแกนไวรัส';
    case 'sanitised': return 'ตรวจสอบแล้ว (ล้างส่วนที่เสี่ยงออก)';
    case 'blocked': return 'ถูกกักไว้ — พบปัญหา';
    default: return status;
  }
}

function mappingStatusLabel(status: string): string {
  switch (status) {
    case 'owner_confirmed': return 'เจ้าของยืนยันแล้ว';
    case 'validated': return 'รับรองแล้ว';
    case 'returned': return 'ถูกส่งกลับ';
    case 'revoked': return 'ยกเลิกแล้ว';
    default: return status;
  }
}
