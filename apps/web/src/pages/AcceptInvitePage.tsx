// The invitee's side of CCR-014: turn an invite token into a password.
//
// Unauthenticated by contract — an `invited` account has no password, so it
// cannot hold a bearer token. The token arrives out of band (the admin passes
// it on), so it is accepted both from ?token= in the URL and as a typed field:
// an on-prem school may have no email, and a code read off a printed slip has to
// be enterable by hand.
//
// On success this does NOT log the user in. The API returns 204 by design so
// that `invited` → `active` stays enforced in exactly one place — login.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';

// Mirrors AcceptInviteRequest.password.minLength in openapi.yaml and
// MIN_PASSWORD_LENGTH in packages/auth — change all three together.
const MIN_PASSWORD_LENGTH = 12;

export function AcceptInvitePage() {
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
    if (!token.trim()) return setError('กรอกรหัสเชิญ');
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`);
    }
    // Checked here rather than server-side: a mistyped confirmation is a UI
    // concern, and sending it to the API would mean transmitting the password
    // twice for no benefit.
    if (password !== confirm) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');

    setBusy(true);
    api
      .POST('/auth/accept-invite', { body: { invite_token: token.trim(), password } })
      .then((res) => {
        if (res.error) throw new ApiError(res.error.code, res.error.message);
        setDone(true);
      })
      .catch((err) => {
        // AUTH-005 covers unknown / expired / already-used without distinguishing
        // them — the Thai copy has to be equally non-committal or it becomes the
        // oracle the API refuses to be.
        setError(err instanceof ApiError ? thaiMessageFor(err) : 'ตั้งรหัสผ่านไม่สำเร็จ');
      })
      .finally(() => setBusy(false));
  }

  if (done) {
    return (
      <main className="page">
        <h1>ตั้งรหัสผ่านเรียบร้อย</h1>
        <div className="alert alert-success" role="status">
          <span>บัญชีของคุณพร้อมใช้งานแล้ว เข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่เพิ่งตั้ง</span>
        </div>
        <button type="button" className="btn btn-primary btn-full" onClick={() => navigate('/login')}>
          ไปหน้าเข้าสู่ระบบ
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>ตั้งรหัสผ่านครั้งแรก</h1>
      <p className="field-hint">
        ใช้รหัสเชิญที่ได้รับจากผู้ดูแลระบบของโรงเรียน ผู้ดูแลระบบจะไม่ทราบรหัสผ่านที่คุณตั้ง
      </p>

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="invite-token">รหัสเชิญ</label>
          <input
            id="invite-token" type="text" value={token}
            onChange={(e) => setToken(e.target.value)} required autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">รหัสผ่านใหม่</label>
          <input
            id="new-password" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password"
          />
          <p className="field-hint">อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร</p>
        </div>
        <div className="field">
          <label htmlFor="confirm-password">ยืนยันรหัสผ่าน</label>
          <input
            id="confirm-password" type="password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password"
          />
        </div>

        {error && <div className="field-error" role="alert">{error}</div>}

        <button type="submit" className="btn btn-primary btn-full" disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'ตั้งรหัสผ่าน'}
        </button>
      </form>

      <p className="field-hint" style={{ marginTop: 16 }}>
        มีบัญชีอยู่แล้ว? <Link to="/login">เข้าสู่ระบบ</Link>
      </p>
    </main>
  );
}
