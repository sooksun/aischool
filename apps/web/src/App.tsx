import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { STEP_UP_EVENT, WEB_SSO, webLoginHref } from './api/client';
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
import { MembersPage } from './pages/admin/MembersPage';
import { AreaSchoolsPage } from './pages/area/AreaSchoolsPage';
import { DevicesPage } from './pages/DevicesPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { AgreementPage } from './pages/agreements/AgreementPage';

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
/**
 * FR-019: a person at more than one school picks which one they are working for;
 * the pick is remembered per account. Until they pick, writes would be ambiguous
 * (the API answers PERM-002), so the page says so plainly.
 */
function SchoolPicker() {
  const { user, schools, schoolId, selectSchool } = useAuth();
  if (!user || schools.length < 2) return null;
  return (
    <div className={schoolId ? 'school-picker' : 'alert alert-info'} role={schoolId ? undefined : 'alert'}>
      <label htmlFor="school-picker">{schoolId ? 'โรงเรียน' : 'คุณอยู่หลายโรงเรียน กรุณาเลือกโรงเรียนที่กำลังทำงานให้'}</label>{' '}
      <select id="school-picker" value={schoolId ?? ''} onChange={(e) => selectSchool(e.target.value)}>
        {!schoolId && <option value="" disabled>เลือกโรงเรียน</option>}
        {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}

function AppNav() {
  const { user, capabilities } = useAuth();
  const location = useLocation();
  if (!user || location.pathname === '/login') return null;

  const { manageCycles, scoreAsCommittee, viewReports, submitEvidence, manageMembers, manageAreaSchools } = capabilities;
  if (!manageCycles && !scoreAsCommittee && !viewReports && !submitEvidence && !manageMembers && !manageAreaSchools) return null;

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
      <Link to="/agreements" className={location.pathname.startsWith('/agreements') ? 'active' : ''}>
        ข้อตกลง PA
      </Link>
      {manageMembers && (
        <Link to="/admin/members" className={location.pathname.startsWith('/admin') ? 'active' : ''}>
          บุคลากร
        </Link>
      )}
      {manageAreaSchools && (
        <Link to="/area/schools" className={location.pathname.startsWith('/area') ? 'active' : ''}>
          โรงเรียนในเขต
        </Link>
      )}
      {scoreAsCommittee && (
        <Link to="/evaluator" className={location.pathname.startsWith('/evaluator') ? 'active' : ''}>
          งานกรรมการ
        </Link>
      )}
      <Link to="/devices" className={location.pathname === '/devices' ? 'active' : ''}>
        อุปกรณ์
      </Link>
      {viewReports && (
        <Link to="/reports" className={location.pathname.startsWith('/reports') ? 'active' : ''}>
          รายงาน PA
        </Link>
      )}
    </nav>
  );
}

/**
 * ADR-0014 step-up: when the API answers AUTH-006, offer a sign-in with the
 * second factor that returns to this page. A link, not an automatic redirect,
 * so nothing half-typed on the page (a return note, say) is lost unasked.
 */
function StepUpBanner() {
  const [needed, setNeeded] = useState(false);
  const location = useLocation();
  useEffect(() => {
    const on = () => setNeeded(true);
    window.addEventListener(STEP_UP_EVENT, on);
    return () => window.removeEventListener(STEP_UP_EVENT, on);
  }, []);
  useEffect(() => setNeeded(false), [location.pathname]);
  if (!needed) return null;
  return (
    <div className="alert alert-info" role="alert">
      <span>รายการนี้ต้องยืนยันตัวตนด้วยรหัส OTP อีกขั้นหนึ่ง</span>
      {WEB_SSO
        ? <a className="btn btn-primary" href={webLoginHref(location.pathname + location.search, 'mfa')}>ยืนยันตัวตนด้วย OTP</a>
        : <span>กรุณาออกจากระบบแล้วเข้าสู่ระบบด้วย SEIP ID</span>}
    </div>
  );
}

export function App() {
  // Switching school remounts the routes, so every page reloads its data for the
  // school now in X-School-Id instead of showing the previous school's.
  const { schoolId } = useAuth();
  return (
    <>
      <AppNav />
      <SchoolPicker />
      <StepUpBanner />
      <Routes key={schoolId ?? 'no-school'}>
        <Route path="/login" element={<LoginPage />} />
        {/* Unauthenticated by contract: the invitee has no password yet, so they
            cannot be behind RequireAuth. Mirrors permissions.yaml's
            `unauthenticated: acceptInvite`. */}
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/" element={<RequireAuth><EvidenceListPage /></RequireAuth>} />
        {/* Gated, unlike before: an evaluator typing this URL used to get the
            full 5-step form and only discovered the dead end at POST /evidence. */}
        <Route path="/evidence/new" element={
          <RequireCapability capability="submitEvidence"><EvidenceSubmitPage /></RequireCapability>
        } />
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

        {/* CCR-015: the evaluatee writes their own PA1. Behind RequireAuth
            rather than a capability — every role that can be evaluated needs it,
            and the page itself explains the case where the account has no
            personnel record (an external evaluator). */}
        <Route path="/agreements" element={<RequireAuth><AgreementPage /></RequireAuth>} />

        <Route path="/admin/members" element={
          <RequireCapability capability="manageMembers"><MembersPage /></RequireCapability>
        } />

        <Route path="/devices" element={<RequireAuth><DevicesPage /></RequireAuth>} />

        <Route path="/area/schools" element={
          <RequireCapability capability="manageAreaSchools"><AreaSchoolsPage /></RequireCapability>
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
