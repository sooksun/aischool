import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import type { UiCapability } from './lib/capabilities';
import { LoginPage } from './pages/LoginPage';
import { EvidenceListPage } from './pages/EvidenceListPage';
import { EvidenceSubmitPage } from './pages/EvidenceSubmitPage';
import { EvidenceDetailPage } from './pages/EvidenceDetailPage';
import { CycleListPage } from './pages/director/CycleListPage';
import { CycleDetailPage } from './pages/director/CycleDetailPage';
import { RoundAssignmentsPage } from './pages/director/RoundAssignmentsPage';
import { ReportListPage } from './pages/reports/ReportListPage';
import { ReportDetailPage } from './pages/reports/ReportDetailPage';
import { EvaluatorHomePage } from './pages/evaluator/EvaluatorHomePage';
import { EvaluatorCyclePage } from './pages/evaluator/EvaluatorCyclePage';
import { EvaluatorRoundPage } from './pages/evaluator/EvaluatorRoundPage';
import { AssignmentScorePage } from './pages/evaluator/AssignmentScorePage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading" role="status">กำลังโหลด…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * UI-side gate on a capability flag (from memberships once via useAuth).
 * Never substitutes for permissions.yaml — denied API calls still surface PERM-001.
 */
function RequireCapability({
  capability,
  children,
}: {
  capability: UiCapability;
  children: React.ReactNode;
}) {
  const { user, loading, capabilities } = useAuth();
  if (loading) return <div className="page-loading" role="status">กำลังโหลด…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!capabilities[capability]) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Nav driven by capability flags — no ad-hoc role arrays (cleanup M3). */
function AppNav() {
  const { user, capabilities } = useAuth();
  const location = useLocation();
  if (!user || location.pathname === '/login') return null;

  const { manageCycles, scoreAsCommittee, viewReports, submitEvidence } = capabilities;
  if (!manageCycles && !scoreAsCommittee && !viewReports && !submitEvidence) return null;

  return (
    <nav className="app-nav" aria-label="เมนูหลัก">
      <Link to="/" className={location.pathname === '/' ? 'active' : ''}>หลักฐานของฉัน</Link>
      {/* The only other way in is the floating '+' on the evidence list, whose
          label lives in aria-label — visible to a screen reader, invisible to
          everyone else. A teacher who was never shown that button cannot find
          upload at all, so the primary action gets a named nav entry. */}
      {submitEvidence && (
        <Link to="/evidence/new" className={location.pathname === '/evidence/new' ? 'active' : ''}>
          + ส่งหลักฐาน
        </Link>
      )}
      {manageCycles && (
        <Link to="/director/cycles" className={location.pathname.startsWith('/director') ? 'active' : ''}>
          จัดการรอบการประเมิน
        </Link>
      )}
      {scoreAsCommittee && (
        <Link to="/evaluator" className={location.pathname.startsWith('/evaluator') ? 'active' : ''}>
          งานกรรมการ
        </Link>
      )}
      {viewReports && (
        <Link to="/reports" className={location.pathname.startsWith('/reports') ? 'active' : ''}>
          รายงาน PA
        </Link>
      )}
    </nav>
  );
}

export function App() {
  return (
    <>
      <AppNav />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><EvidenceListPage /></RequireAuth>} />
        <Route path="/evidence/new" element={<RequireAuth><EvidenceSubmitPage /></RequireAuth>} />
        <Route path="/evidence/:evidenceId" element={<RequireAuth><EvidenceDetailPage /></RequireAuth>} />

        <Route path="/director/cycles" element={
          <RequireCapability capability="manageCycles"><CycleListPage /></RequireCapability>
        } />
        <Route path="/director/cycles/:cycleId" element={
          <RequireCapability capability="manageCycles"><CycleDetailPage /></RequireCapability>
        } />
        <Route path="/director/rounds/:roundId/assignments" element={
          <RequireCapability capability="manageCycles"><RoundAssignmentsPage /></RequireCapability>
        } />

        <Route path="/reports" element={
          <RequireCapability capability="viewReports"><ReportListPage /></RequireCapability>
        } />
        <Route path="/reports/:reportId" element={
          <RequireCapability capability="viewReports"><ReportDetailPage /></RequireCapability>
        } />

        <Route path="/evaluator" element={
          <RequireCapability capability="scoreAsCommittee"><EvaluatorHomePage /></RequireCapability>
        } />
        <Route path="/evaluator/cycles/:cycleId" element={
          <RequireCapability capability="scoreAsCommittee"><EvaluatorCyclePage /></RequireCapability>
        } />
        <Route path="/evaluator/rounds/:roundId" element={
          <RequireCapability capability="scoreAsCommittee"><EvaluatorRoundPage /></RequireCapability>
        } />
        <Route path="/evaluator/assignments/:assignmentId" element={
          <RequireCapability capability="scoreAsCommittee"><AssignmentScorePage /></RequireCapability>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
