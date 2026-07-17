// openapi-fetch (same maintainer as openapi-typescript, which generates
// schema.generated.ts) — chosen over a hand-rolled generic client after the
// hand-rolled version's type inference broke down against openapi-typescript's
// `responses` union (success ∪ every error shape); this library solves exactly
// that problem and is a natural pairing, not scope creep beyond ADR-0006's
// "keep dependencies lean" (it is a ~2KB purpose-fit client, not a framework).
//
// `api` is the raw client — call sites use its idiomatic `{data, error}` return
// (openapi-fetch's own documented pattern) and pass the result through unwrap()
// to get "data or throw ApiError". A first attempt WRAPPED api.GET/POST/etc in
// new functions to make them throw directly, but casting those wrappers to
// match openapi-fetch's own generic method types silently substituted `any`
// for the real per-path inference — every call site typechecked with the
// WRONG data shape. Not re-wrapping keeps the generics openapi-fetch already
// gets right; unwrap() only ever sees an already-concrete result, so its own
// generic is simple and correctly inferred.
import createClient from 'openapi-fetch';
import type { paths } from './schema.generated';
import { ApiError } from './errors';

export const api = createClient<paths>({ baseUrl: '/api/v1' });

let accessToken: string | null = null;
let refreshToken: string | null = null;
let currentSchoolId: string | null = null;
export function setAccessToken(token: string | null) { accessToken = token; }
export function setRefreshToken(token: string | null) { refreshToken = token; }
export function setCurrentSchoolId(schoolId: string | null) { currentSchoolId = schoolId; }

/** AuthProvider registers these so the transparent-refresh middleware below can
 * persist a rotated pair / force a re-login without client.ts importing React. */
interface SessionHooks {
  onRefreshed?: (pair: { access_token: string; refresh_token: string }) => void;
  onExpired?: () => void;
}
let sessionHooks: SessionHooks = {};
export function registerSessionHooks(hooks: SessionHooks) { sessionHooks = hooks; }

/** Single-flight: concurrent 401s share one refresh call (CCR-008 rotation —
 * firing two refreshes with the same token would trip its own reuse detection). */
let refreshInFlight: Promise<boolean> | null = null;
async function tryRefreshSession(): Promise<boolean> {
  if (!refreshToken) return false;
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const pair = (await res.json()) as { access_token: string; refresh_token: string };
      accessToken = pair.access_token;
      refreshToken = pair.refresh_token;
      sessionHooks.onRefreshed?.(pair);
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// A Request's body is consumed by the time onResponse sees it, so the retry
// needs a clone taken BEFORE dispatch. Keyed on the request instance itself;
// entries are removed in onResponse, so nothing outlives its round-trip.
const retryClones = new WeakMap<Request, Request>();
const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

api.use({
  onRequest({ request }) {
    if (accessToken) request.headers.set('authorization', `Bearer ${accessToken}`);
    if (currentSchoolId) request.headers.set('x-school-id', currentSchoolId);
    retryClones.set(request, request.clone());
    return request;
  },
  async onResponse({ request, response }) {
    const clone = retryClones.get(request);
    retryClones.delete(request);
    if (response.status !== 401 || AUTH_PATHS.some((p) => request.url.includes(p))) {
      return response;
    }
    if (!(await tryRefreshSession())) {
      sessionHooks.onExpired?.();
      return response;
    }
    if (!clone) return response;
    const headers = new Headers(clone.headers);
    headers.set('authorization', `Bearer ${accessToken}`);
    return fetch(new Request(clone, { headers }));
  },
});

export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error !== undefined) {
    const e = result.error as { code?: string; message?: string; details?: { field: string; issue: string }[]; request_id?: string };
    throw new ApiError(e.code ?? 'SYS-001', e.message ?? 'Request failed', e.details, e.request_id);
  }
  return result.data as T;
}
