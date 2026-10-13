import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ApiError, thaiMessageFor } from '../api/errors';
import { WEB_SSO, webLoginHref } from '../api/client';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // webCallback sends any failed Keycloak sign-in back here (CCR-018).
  const [params] = useSearchParams();
  const ssoFailed = params.get('error') === 'sso';

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? thaiMessageFor(err) : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <h1>เข้าสู่ระบบ SEIP</h1>
      {WEB_SSO && (
        <section aria-label="เข้าสู่ระบบด้วยบัญชี SEIP ID">
          {ssoFailed && (
            <div className="alert alert-error" role="alert">
              <span aria-hidden="true">⚠</span>
              <span>เข้าสู่ระบบด้วย SEIP ID ไม่สำเร็จ กรุณาลองใหม่</span>
            </div>
          )}
          {/* A full-page navigation, not fetch: the browser must follow the
              redirect to Keycloak and come back with the session cookie. */}
          <a className="btn btn-primary btn-full" href={webLoginHref('/')}>เข้าสู่ระบบด้วย SEIP ID</a>
          <p className="field-hint">หรือใช้อีเมลและรหัสผ่านเดิมด้านล่าง</p>
        </section>
      )}
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="email">อีเมล</label>
          <input
            id="email" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">รหัสผ่าน</label>
          <input
            id="password" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
          {submitting ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </main>
  );
}
