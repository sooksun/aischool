// ApiError — the one place a route handler throws a contract error. Carries an
// ErrorCode (so the HTTP status and shape in error-codes.yaml can never be typed
// wrong at the call site) and renders to exactly the Error schema in openapi.yaml.
import { httpStatusFor, type ErrorCode } from './error-codes.generated.js';

export interface ErrorDetail {
  field: string;
  issue: string;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly http: number;
  readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.http = httpStatusFor(code);
    this.details = details;
  }

  /** Shape matches components.schemas.Error in openapi.yaml exactly. */
  toBody(requestId: string) {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      request_id: requestId,
    };
  }
}

/**
 * RES-001 by design: cross-school and truly-missing resources render identically
 * (permissions.yaml tenancy rule — existence must never leak). Every "not found or
 * not yours" path in the API should throw this one helper, not hand-roll the code.
 */
export function notFound(entity: string): ApiError {
  return new ApiError('RES-001', `${entity} not found`);
}

export function forbiddenRole(): ApiError {
  return new ApiError('PERM-001', 'Role not allowed for this operation');
}

export function forbiddenCrossSchool(): ApiError {
  // Reserved for same-school role denials where existence is already known
  // (permissions.yaml comment) — cross-tenant reads use notFound() instead.
  return new ApiError('PERM-002', 'Cross-school access denied');
}

export function forbiddenAreaWrite(): ApiError {
  return new ApiError('PERM-004', 'Area-scoped role may not write outside read-only scope');
}
