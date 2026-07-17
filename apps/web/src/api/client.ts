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
let currentSchoolId: string | null = null;
export function setAccessToken(token: string | null) { accessToken = token; }
export function setCurrentSchoolId(schoolId: string | null) { currentSchoolId = schoolId; }

api.use({
  onRequest({ request }) {
    if (accessToken) request.headers.set('authorization', `Bearer ${accessToken}`);
    if (currentSchoolId) request.headers.set('x-school-id', currentSchoolId);
    return request;
  },
});

export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error !== undefined) {
    const e = result.error as { code?: string; message?: string; details?: { field: string; issue: string }[]; request_id?: string };
    throw new ApiError(e.code ?? 'SYS-001', e.message ?? 'Request failed', e.details, e.request_id);
  }
  return result.data as T;
}
