// P3 (ADR-0010): the owner's box of suggested indicators for one item. A
// suggestion is only a suggestion — nothing is mapped until the owner presses
// "ใช่ ผูกตัวชี้วัดนี้", which creates an owner_confirmed mapping the director
// still validates. While the in-country model is not running, suggestions come
// from the word-matching floor and are labelled as such.
import { useCallback, useEffect, useState } from 'react';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';

type Suggestion = components['schemas']['Suggestion'];
type Analysis = components['schemas']['Analysis'];
type RejectReason = components['schemas']['SuggestionRejectReason'];

const BAND_TH: Record<Suggestion['band'], string> = { clear: 'ชัดเจน', likely: 'น่าจะใช่', possible: 'อาจเกี่ยวข้อง' };
const REASON_TH: Record<RejectReason, string> = {
  not_relevant: 'ไม่เกี่ยวข้อง',
  wrong_indicator: 'ผิดตัวชี้วัด',
  weak_evidence: 'หลักฐานยังไม่พอ',
  wrong_period: 'ไม่ใช่ช่วงเวลานี้',
  duplicate: 'ซ้ำกับที่ผูกแล้ว',
  other: 'อื่น ๆ',
};
const RUNNING: Analysis['status'][] = ['queued', 'extracting', 'perceiving', 'mapping', 'validating'];

export function SuggestionsPanel({ evidenceId, onMapped }: { evidenceId: string; onMapped: () => void }) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState<RejectReason>('not_relevant');

  const load = useCallback(async () => {
    try {
      const page = unwrap(await api.GET('/evidence/{evidenceId}/suggestions', { params: { path: { evidenceId }, query: { status: 'open' } } }));
      setItems(page.items);
      setAnalysis(page.analysis ?? null);
    } catch {
      setItems([]);
    }
  }, [evidenceId]);

  useEffect(() => { void load(); }, [load]);

  // While the analysis runs, check again every few seconds.
  useEffect(() => {
    if (!analysis || !RUNNING.includes(analysis.status)) return;
    const t = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(t);
  }, [analysis, load]);

  async function accept(s: Suggestion) {
    setBusy(s.id);
    setErr(null);
    try {
      unwrap(await api.POST('/suggestions/{suggestionId}/accept', {
        params: { path: { suggestionId: s.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      }));
      await load();
      onMapped();
    } catch (e) {
      setErr(e instanceof ApiError ? thaiMessageFor(e) : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  async function reject(s: Suggestion) {
    setBusy(s.id);
    setErr(null);
    try {
      unwrap(await api.POST('/suggestions/{suggestionId}/reject', {
        params: { path: { suggestionId: s.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { reason_code: reason },
      }));
      setRejecting(null);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? thaiMessageFor(e) : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  async function rerun() {
    setErr(null);
    try {
      setAnalysis(unwrap(await api.POST('/evidence/{evidenceId}/analysis', { params: { path: { evidenceId } } })));
    } catch (e) {
      setErr(e instanceof ApiError ? thaiMessageFor(e) : 'สั่งวิเคราะห์ไม่สำเร็จ');
    }
  }

  if (items === null) return null;
  const running = analysis && RUNNING.includes(analysis.status);
  return (
    <section aria-label="ตัวชี้วัดที่ระบบแนะนำ">
      <h2>ตัวชี้วัดที่ระบบแนะนำ</h2>
      {running && <p className="field-hint" role="status">กำลังวิเคราะห์หลักฐาน…</p>}
      {analysis?.provisional && !running && (
        <p className="field-hint">
          คำแนะนำชุดนี้มาจากระบบสำรองแบบจับคำ (ยังไม่ใช่ AI ในประเทศ) — โปรดตรวจเองทุกข้อ ระบบไม่ผูกตัวชี้วัดให้จนกว่าคุณจะกดยืนยัน
        </p>
      )}
      {!running && items.length === 0 && <p className="field-hint">ยังไม่มีคำแนะนำ — ผูกตัวชี้วัดเองได้ที่หัวข้อด้านล่าง</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((s) => (
          <li key={s.id} className="evidence-card" style={{ marginBottom: 8 }}>
            <div className="title">{s.indicator_code} · {BAND_TH[s.band]}</div>
            {/* Plain text only: model output is never rendered as markup (FR-028). */}
            {s.rationale_th && <p className="field-hint">{s.rationale_th}</p>}
            {s.locators.map((l) => l.quote && (
              <blockquote key={l.segment_id} style={{ margin: '4px 0', paddingLeft: 12, borderLeft: '3px solid var(--border, #ccc)' }}>
                {l.page ? `หน้า ${l.page}: ` : ''}“{l.quote}”
              </blockquote>
            ))}
            {rejecting === s.id ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <label className="field" style={{ margin: 0 }}>
                  <span>เหตุผล</span>
                  <select value={reason} onChange={(e) => setReason(e.target.value as RejectReason)}>
                    {Object.entries(REASON_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-secondary" disabled={busy === s.id} onClick={() => void reject(s)}>ยืนยันว่าไม่ใช่</button>
                <button type="button" className="btn btn-secondary" onClick={() => setRejecting(null)}>ยกเลิก</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-primary" disabled={busy === s.id} onClick={() => void accept(s)}>ใช่ ผูกตัวชี้วัดนี้</button>
                <button type="button" className="btn btn-secondary" disabled={busy === s.id} onClick={() => setRejecting(s.id)}>ไม่ใช่</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {err && <div className="field-error" role="alert">{err}</div>}
      {!running && <button type="button" className="btn btn-secondary" onClick={() => void rerun()}>วิเคราะห์ใหม่</button>}
    </section>
  );
}
