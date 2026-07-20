// Shared personnel lookup (CCR-014).
//
// Before listPersonnel existed, four screens rendered `evaluatee_personnel_id`
// as primary user-facing text — a director's committee screen identified
// teachers by `550e8400-e29b-...`. Every one of those call sites needs the same
// id → name map, so it lives here rather than being fetched four times.
//
// Failure is deliberately soft: `nameFor` falls back to the raw id. A screen
// that cannot load names is degraded, not broken, and the id is still a true
// (if unfriendly) identifier — better than blocking committee work outright.
import { useEffect, useMemo, useState } from 'react';
import { api, unwrap } from '../api/client';
import type { components } from '../api/schema.generated';

export type PersonnelSummary = components['schemas']['PersonnelSummary'];

export interface PersonnelLookup {
  personnel: PersonnelSummary[] | null;
  /** Loading is `personnel === null && !failed`. */
  failed: boolean;
  /** Display name for a personnel id, falling back to the id itself. */
  nameFor: (personnelId: string) => string;
}

export function usePersonnel(options: { positionRole?: 'teacher' | 'administrator' } = {}): PersonnelLookup {
  const [personnel, setPersonnel] = useState<PersonnelSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { positionRole } = options;

  useEffect(() => {
    let cancelled = false;
    api
      .GET('/personnel', { params: { query: positionRole ? { position_role: positionRole } : {} } })
      .then((res) => {
        const data = unwrap(res);
        // Array.isArray, not a bare cast: this hook renders into four screens and
        // a non-array payload (a proxy error page, a contract drift) would throw
        // inside useMemo and blank the whole page. Treat it as a load failure and
        // fall back to raw ids, which is the same graceful degradation as a 5xx.
        if (!cancelled) {
          if (Array.isArray(data)) setPersonnel(data);
          else setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [positionRole]);

  const byId = useMemo(() => new Map((personnel ?? []).map((p) => [p.id, p])), [personnel]);

  return {
    personnel,
    failed,
    nameFor: (personnelId: string) => byId.get(personnelId)?.full_name ?? personnelId,
  };
}
