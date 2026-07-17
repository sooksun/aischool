import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { EvidenceListPage } from './pages/EvidenceListPage';
import { EvidenceSubmitPage } from './pages/EvidenceSubmitPage';
import { EvidenceDetailPage } from './pages/EvidenceDetailPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading" role="status">กำลังโหลด…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth><EvidenceListPage /></RequireAuth>} />
      <Route path="/evidence/new" element={<RequireAuth><EvidenceSubmitPage /></RequireAuth>} />
      <Route path="/evidence/:evidenceId" element={<RequireAuth><EvidenceDetailPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
