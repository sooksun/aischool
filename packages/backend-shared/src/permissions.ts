// Runtime loader for permissions.yaml (SEC-TEN-5): the matrix is read from the
// LOCKED CONTRACT FILE ITSELF, not re-typed by hand into TypeScript. A permission
// change requires a CCR + version bump on the YAML (contract-policy.md); this
// module can't drift from it because it has no independent copy to drift from.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';

// Walk up from this package to the repo root to find docs/contracts — works both
// from ts-node/tsx (src/) and from the compiled dist/ output.
function findRepoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(resolve(dir, 'docs/contracts/permissions.yaml'));
      return dir;
    } catch {
      dir = resolve(dir, '..');
    }
  }
  throw new Error('could not locate docs/contracts/permissions.yaml from ' + from);
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const doc = yaml.load(
  readFileSync(resolve(repoRoot, 'docs/contracts/permissions.yaml'), 'utf8'),
) as PermissionsDoc;

export type Role = 'teacher' | 'director' | 'deputy' | 'evaluator' | 'school_admin' | 'area_admin';
type Grant = string; // 'own' | 'school' | 'area-r' | 'committee' | 'own-revoke' | 'committee-or-own'...

interface PermissionsDoc {
  version: string;
  unauthenticated?: Record<string, string>;
  any_authenticated?: Record<string, string>;
  matrix: Record<string, Record<string, Grant>>;
}

export const PERMISSIONS_VERSION = doc.version;

/** operationId -> per-role grant, or undefined if the op needs no role check (see isExempt). */
export function grantFor(operationId: string, role: Role): Grant | undefined {
  return doc.matrix[operationId]?.[role];
}

export function isExempt(operationId: string): 'unauthenticated' | 'any_authenticated' | false {
  if (doc.unauthenticated && operationId in doc.unauthenticated) return 'unauthenticated';
  if (doc.any_authenticated && operationId in doc.any_authenticated) return 'any_authenticated';
  return false;
}

/** True if this operationId has SOME disposition (grant or exemption) — the same
 * invariant scripts/security/validate-contracts.mjs checks at the contract layer;
 * this is the runtime mirror so a missing rule fails closed, not open. */
export function hasDisposition(operationId: string): boolean {
  return Boolean(doc.matrix[operationId]) || Boolean(isExempt(operationId));
}
