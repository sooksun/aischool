/**
 * FR-019: which school a request speaks for. One school → that one, as the API
 * resolves it (CCR-003). More than one → the person picks, and the pick is
 * remembered per account (default = the school used last). The API still
 * validates X-School-Id against the caller's own memberships; this only chooses.
 */
import type { components } from '../api/schema.generated';

type Membership = components['schemas']['CurrentUser']['memberships'][number];

export interface SchoolOption { id: string; name: string }

export function schoolOptions(memberships: readonly Membership[]): SchoolOption[] {
  const seen = new Map<string, SchoolOption>();
  for (const m of memberships) {
    if (m.membership_scope === 'school' && m.school_id && !seen.has(m.school_id)) {
      seen.set(m.school_id, { id: m.school_id, name: m.school_name ?? m.school_id });
    }
  }
  return [...seen.values()];
}

/** The school to use: the only one, else the remembered one if still a membership, else none (ask). */
export function pickSchool(options: readonly SchoolOption[], remembered: string | null): string | null {
  if (options.length === 1) return options[0].id;
  return options.some((o) => o.id === remembered) ? remembered : null;
}

const key = (userId: string) => `seip.school.${userId}`;

export function rememberedSchool(userId: string): string | null {
  try { return localStorage.getItem(key(userId)); } catch { return null; }
}

export function rememberSchool(userId: string, schoolId: string): void {
  try { localStorage.setItem(key(userId), schoolId); } catch { /* private mode: the pick lasts this session */ }
}
