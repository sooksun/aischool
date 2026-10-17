// FR-099a / CCR-023: on first use, the person checks the profile the school
// admin entered (position, วิทยฐานะ, date granted) and confirms it or asks for a
// correction. Hidden once confirmed.
import { useState } from 'react';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import type { components } from '../api/schema.generated';

type Personnel = NonNullable<components['schemas']['CurrentUser']['personnel']>;

const POSITION_LABEL = { teacher: 'ครู', administrator: 'ผู้บริหารสถานศึกษา' } as const;

export function ProfileConfirmBanner({ personnel }: { personnel: Personnel }) {
  const [state, setState] = useState<{ confirmed: boolean; note: string | null }>({
    confirmed: !!personnel.confirmed_at, note: personnel.correction_note ?? null,
  });
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (state.confirmed) return null;

  const fail = (e: unknown) => setError(e instanceof ApiError ? thaiMessageFor(e) : 'บันทึกไม่สำเร็จ');
  async function confirm() {
    try {
      unwrap(await api.POST('/me/personnel/confirm'));
      setState({ confirmed: true, note: null });
    } catch (e) { fail(e); }
  }
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = unwrap(await api.POST('/me/personnel/correction', { body: { note: note.trim() } }));
      setState({ confirmed: false, note: r.correction_note ?? note.trim() });
      setAsking(false);
    } catch (err) { fail(err); }
  }

  return (
    <div className="alert alert-info" role="region" aria-label="ตรวจข้อมูลบุคลากร">
      <div>
        <strong>ตรวจข้อมูลของคุณ</strong>
        <div>
          {personnel.full_name ?? ''} · {POSITION_LABEL[personnel.position_role]} · วิทยฐานะ {personnel.rank_level_code}
          {personnel.rank_since && <> (ตั้งแต่ {personnel.rank_since})</>}
        </div>
        {state.note && <div>ส่งคำขอแก้ไขแล้ว: “{state.note}” — รอผู้ดูแลระบบโรงเรียนแก้ไข</div>}
        {error && <div className="field-error" role="alert">{error}</div>}
      </div>
      {!asking ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={confirm}>ข้อมูลถูกต้อง</button>
          <button type="button" className="btn btn-secondary" onClick={() => setAsking(true)}>ขอแก้ไข</button>
        </div>
      ) : (
        <form onSubmit={ask}>
          <label htmlFor="correction-note">สิ่งที่ต้องแก้ไข</label>
          <textarea id="correction-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} required />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary">ส่งคำขอ</button>
            <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>ยกเลิก</button>
          </div>
        </form>
      )}
    </div>
  );
}
