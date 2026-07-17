import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, hasRole } from './hooks/useAuth';
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
import type { components } from './api/schema.generated';

type Role = components['schemas']['Role'];

const DIRECTOR_ROLES: Role[] = ['director', 'school_admin'];
const REPORT_NAV_ROLES: Role[] = ['director', 'school_admin', 'teacher', 'deputy', 'evaluator'];
/** Committee scorers: evaluator role + director as chair/member (permissions matrix). */
const EVALUATOR_NAV_ROLES: Role[] = ['evaluator', 'director'];

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading" role="status">กำลังโหลด…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading" role="status">กำลังโหลด…</div>;
  if (!user) return <Navigate to="/login" replace />;
  // UI-side gate only — hides the affordance, never the real enforcement
  // (permissions.yaml is; module-boundaries.md). A denied API call still
  // renders its own PERM-001 error if this check is ever bypassed directly.
  if (!hasRole(user, roles)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Thin role-aware shell: no page currently owns cross-page navigation, so this
 * is the one place a director/school_admin can reach the cycle-management area
 * without editing EvidenceListPage.tsx (out of this task's primary_paths). */
function AppNav() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user || location.pathname === '/login') return null;
  const isDirector = hasRole(user, DIRECTOR_ROLES);
  const showReports = hasRole(user, REPORT_NAV_ROLES);
  const isEvaluatorNav = hasRole(user, EVALUATOR_NAV_ROLES);
  if (!isDirector && !showReports && !isEvaluatorNav) return null;
  return (
    <nav className="app-nav" aria-label="เมนูหลัก">
      <Link to="/" className={location.pathname === '/' ? 'active' : ''}>หลักฐานของฉัน</Link>
      {isDirector && (
        <Link to="/director/cycles" className={location.pathname.startsWith('/director') ? 'active' : ''}>
          จัดการรอบการประเมิน
        </Link>
      )}
      {isEvaluatorNav && (
        <Link to="/evaluator" className={location.pathname.startsWith('/evaluator') ? 'active' : ''}>
          งานกรรมการ
        </Link>
      )}
      {showReports && (
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
          <RequireRole roles={DIRECTOR_ROLES}><CycleListPage /></RequireRole>
        } />
        <Route path="/director/cycles/:cycleId" element={
          <RequireRole roles={DIRECTOR_ROLES}><CycleDetailPage /></RequireRole>
        } />
        <Route path="/director/rounds/:roundId/assignments" element={
          <RequireRole roles={DIRECTOR_ROLES}><RoundAssignmentsPage /></RequireRole>
        } />

        <Route path="/reports" element={<RequireAuth><ReportListPage /></RequireAuth>} />
        <Route path="/reports/:reportId" element={<RequireAuth><ReportDetailPage /></RequireAuth>} />

        <Route path="/evaluator" element={
          <RequireRole roles={EVALUATOR_NAV_ROLES}><EvaluatorHomePage /></RequireRole>
        } />
        <Route path="/evaluator/cycles/:cycleId" element={
          <RequireRole roles={EVALUATOR_NAV_ROLES}><EvaluatorCyclePage /></RequireRole>
        } />
        <Route path="/evaluator/rounds/:roundId" element={
          <RequireRole roles={EVALUATOR_NAV_ROLES}><EvaluatorRoundPage /></RequireRole>
        } />
        <Route path="/evaluator/assignments/:assignmentId" element={
          <RequireRole roles={EVALUATOR_NAV_ROLES}><AssignmentScorePage /></RequireRole>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
