// Auth state: token storage + current user + school-context resolution.
//
// KNOWN LIMITATION (documented, not hidden — same discipline as the CCRs):
// openapi.yaml's TokenPair returns access_token/refresh_token in the JSON body,
// not as an httpOnly Set-Cookie header, so the client MUST hold tokens in
// JS-readable storage to attach them as a Bearer header — SEC-AUTH-4's httpOnly
// preference can't be satisfied without a contract change (moving auth to
// cookie-based sessions), which is out of scope here since it would break the
// locked v1.0.0 TokenPair schema. Mitigation within that constraint:
// sessionStorage (not localStorage) — cleared when the tab closes, narrowing the
// window an XSS-stolen token stays valid, and the access token itself is short-
// lived (15 min, ACCESS_TOKEN_TTL_SECONDS in packages/auth).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, unwrap, setAccessToken, setCurrentSchoolId } from '../api/client';
import type { components } from '../api/schema.generated';

type CurrentUser = components['schemas']['CurrentUser'];
type Role = components['schemas']['Role'];

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  /** null = ambiguous (multiple schools, none picked yet) or user has none. */
  schoolId: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'seip.access_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);

  const applySchoolContext = useCallback((u: CurrentUser) => {
    const schoolMemberships = u.memberships.filter((m) => m.membership_scope === 'school' && m.school_id);
    // Same "implicit if exactly one" rule as CCR-003's server-side resolution —
    // the client picks the same way the server would, so 99% of users (a single-
    // school teacher) never see a school picker.
    const resolved = schoolMemberships.length === 1 ? (schoolMemberships[0].school_id ?? null) : null;
    setSchoolId(resolved);
    setCurrentSchoolId(resolved);
  }, []);

  const refreshCurrentUser = useCallback(async () => {
    const u = unwrap(await api.GET('/auth/me', {}));
    setUser(u);
    applySchoolContext(u);
  }, [applySchoolContext]);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) { setLoading(false); return; }
    setAccessToken(stored);
    refreshCurrentUser()
      .catch(() => { sessionStorage.removeItem(STORAGE_KEY); setAccessToken(null); })
      .finally(() => setLoading(false));
  }, [refreshCurrentUser]);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = unwrap(await api.POST('/auth/login', { body: { email, password } }));
    sessionStorage.setItem(STORAGE_KEY, tokens.access_token);
    setAccessToken(tokens.access_token);
    await refreshCurrentUser();
  }, [refreshCurrentUser]);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setAccessToken(null);
    setCurrentSchoolId(null);
    setUser(null);
    setSchoolId(null);
  }, []);

  const value = useMemo(() => ({ user, loading, schoolId, login, logout }), [user, loading, schoolId, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** UI-side role check for hiding affordances — never a substitute for server
 * enforcement (permissions.yaml is the only real gate; module-boundaries.md).
 * A user can hold the same role at multiple schools/areas, or different roles
 * at different ones — this checks role membership only, not which school. */
export function hasRole(user: CurrentUser | null, roles: Role[]): boolean {
  return Boolean(user?.memberships.some((m) => roles.includes(m.role)));
}
