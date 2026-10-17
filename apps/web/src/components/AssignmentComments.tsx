// CCR-028 (FR-064): comments and requests for more information per indicator,
// with replies. Plain text only — no score. The committee and the director
// open a thread; the evaluatee replies. The API decides who may do what; this
// only offers the matching form.
import { useCallback, useEffect, useState } from 'react';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';

type Comment = components['schemas']['AssignmentComment'];
const ROLE_TH: Record<Comment['author_role'], string> = { committee: 'กรรมการ', director: 'ผู้บริหาร', evaluatee: 'ผู้รับการประเมิน' };
const KIND_TH: Record<Comment['kind'], string> = { comment: 'ความเห็น', request_info: 'ขอข้อมูลเพิ่ม', reply: 'ตอบ' };

export function AssignmentComments({ assignmentId, indicatorId, canOpen }: { assignmentId: string; indicatorId: string; canOpen: boolean }) {
  const [items, setItems] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'comment' | 'request_info'>('comment');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(unwrap(await api.GET('/assignments/{assignmentId}/comments', { params: { path: { assignmentId }, query: { indicator_id: indicatorId } } })));
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดความเห็นไม่สำเร็จ');
    }
  }, [assignmentId, indicatorId]);
  useEffect(() => { void load(); }, [load]);

  async function send(body: components['schemas']['AssignmentCommentCreate']) {
    setError(null);
    try {
      unwrap(await api.POST('/assignments/{assignmentId}/comments', { params: { path: { assignmentId } }, body }));
      await load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? thaiMessageFor(e) : 'ส่งไม่สำเร็จ');
      return false;
    }
  }

  if (items === null) return error ? <p className="field-hint">{error}</p> : null;
  return (
    <div aria-label="ความเห็นรายตัวชี้วัด" style={{ marginTop: 8 }}>
      {items.map((c) => (
        <div key={c.id} style={{ marginLeft: c.parent_id ? 24 : 0, borderLeft: '3px solid var(--border, #ccc)', paddingLeft: 8, marginBottom: 6 }}>
          <div className="field-hint">{ROLE_TH[c.author_role]} · {KIND_TH[c.kind]} · {new Date(c.created_at).toLocaleString('th-TH')}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
          {!c.parent_id && (replyTo === c.id ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input aria-label="ข้อความตอบ" value={replyText} maxLength={2000} onChange={(e) => setReplyText(e.target.value)} />
              <button type="button" className="btn btn-primary" disabled={!replyText.trim()} onClick={async () => {
                if (await send({ indicator_id: indicatorId, kind: 'reply', body: replyText.trim(), parent_id: c.id })) { setReplyTo(null); setReplyText(''); }
              }}>ส่ง</button>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setReplyTo(c.id)}>ตอบ</button>
          ))}
        </div>
      ))}
      {canOpen && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <select aria-label="ชนิด" value={kind} onChange={(e) => setKind(e.target.value as 'comment' | 'request_info')}>
            <option value="comment">ความเห็น</option>
            <option value="request_info">ขอข้อมูลเพิ่ม</option>
          </select>
          <input aria-label="ความเห็น" value={text} maxLength={2000} placeholder="ความเห็น (ไม่มีคะแนน)" onChange={(e) => setText(e.target.value)} />
          <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={async () => {
            if (await send({ indicator_id: indicatorId, kind, body: text.trim() })) setText('');
          }}>ส่งความเห็น</button>
        </div>
      )}
      {error && <div className="field-error" role="alert">{error}</div>}
    </div>
  );
}
