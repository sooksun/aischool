import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ApiError, thaiMessageFor } from '../api/errors';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
