// FR-099 / CCR-022: the member's side of a reset the school admin issued. Like
// accept-invite, unauthenticated: the one-time code is the credential, typed in
// or taken from ?token=. On success every earlier session has ended; the person
// signs in again with the new password.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';

// Mirrors PasswordResetComplete.password.minLength in openapi.yaml.
const MIN_PASSWORD_LENGTH = 12;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token.trim()) return setError('กรอกรหัสตั้งรหัสผ่านใหม่');
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`);
    if (password !== confirm) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    setBusy(true);
    api
      .POST('/auth/password-reset', { body: { reset_token: token.trim(), password } })
      .then((res) => {
        if (res.error) throw new ApiError(res.error.code, res.error.message);
        setDone(true);
      })
      .catch((err) => setError(err instanceof ApiError ? thaiMessageFor(err) : 'ตั้งรหัสผ่านไม่สำเร็จ'))
      .finally(() => setBusy(false));
  }

  if (done) {
    return (
      <main className="page">
        <h1>ตั้งรหัสผ่านใหม่เรียบร้อย</h1>
        <div className="alert alert-success" role="status">
          <span>อุปกรณ์ทุกเครื่องออกจากระบบแล้ว เข้าสู่ระบบอีกครั้งด้วยรหัสผ่านใหม่ (ใช้กับ SEIP ID ด้วย)</span>
        </div>
        <button type="button" className="btn btn-primary btn-full" onClick={() => navigate('/login')}>
          ไปหน้าเข้าสู่ระบบ
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>ตั้งรหัสผ่านใหม่</h1>
      <p className="field-hint">ใช้รหัสที่ได้รับจากผู้ดูแลระบบของโรงเรียน รหัสใช้ได้ครั้งเดียวภายใน 30 นาที</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="reset-token">รหัสตั้งรหัสผ่านใหม่</label>
          <input id="reset-token" type="text" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="new-password">รหัสผ่านใหม่</label>
          <input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
          <p className="field-hint">อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร</p>
        </div>
        <div className="field">
          <label htmlFor="confirm-password">ยืนยันรหัสผ่าน</label>
          <input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </div>
        {error && <div className="field-error" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary btn-full" disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'ตั้งรหัสผ่านใหม่'}
        </button>
      </form>
      <p className="field-hint" style={{ marginTop: 16 }}>
        จำรหัสผ่านได้แล้ว? <Link to="/login">เข้าสู่ระบบ</Link>
      </p>
    </main>
  );
}
