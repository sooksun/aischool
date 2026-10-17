/**
 * Staff list CSV → importMembers rows (CCR-019, FR-091). Parsed in the browser
 * so the API stays JSON and typed; the server re-checks every row anyway.
 *
 * Columns (header row, any order, case-insensitive):
 *   email, display_name, role                         required
 *   full_name, position_role, rank_level_code         a personnel profile — all three or none
 *   employee_code                                     optional
 * A UTF-8 BOM (Excel's "CSV UTF-8") is ignored; quoted fields may hold commas,
 * quotes ("") and line breaks.
 */
import type { components } from '../api/schema.generated';

type MemberInvite = components['schemas']['MemberInvite'];
type Personnel = NonNullable<MemberInvite['personnel']>;

export const MEMBER_CSV_COLUMNS = ['email', 'display_name', 'role', 'full_name', 'position_role', 'rank_level_code', 'employee_code'] as const;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export interface MemberCsvResult {
  rows: MemberInvite[];
  /** Problems with the file itself (missing columns); row-level problems are the server's to report. */
  fileErrors: string[];
}

export function membersFromCsv(text: string): MemberCsvResult {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], fileErrors: ['ไฟล์ว่าง'] };
  const index = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const missing = ['email', 'display_name', 'role'].filter((c) => !index.has(c));
  if (missing.length) return { rows: [], fileErrors: [`ไม่พบคอลัมน์ ${missing.join(', ')}`] };

  const cell = (r: string[], name: string) => {
    const i = index.get(name);
    const v = i === undefined ? '' : (r[i] ?? '').trim();
    return v === '' ? undefined : v;
  };
  const rows = body.map((r) => {
    const fullName = cell(r, 'full_name');
    const positionRole = cell(r, 'position_role');
    const rank = cell(r, 'rank_level_code');
    // Values go through as written: an unknown role or position is the server's
    // to reject for this row (VAL-001), with the field named.
    const invite: MemberInvite = {
      email: cell(r, 'email') ?? '',
      display_name: cell(r, 'display_name') ?? '',
      role: (cell(r, 'role') ?? '') as MemberInvite['role'],
    };
    // Any personnel column present → send the profile; the server says which part is missing.
    if (fullName || positionRole || rank) {
      invite.personnel = {
        full_name: fullName ?? '',
        position_role: (positionRole ?? '') as Personnel['position_role'],
        rank_level_code: rank ?? '',
        employee_code: cell(r, 'employee_code') ?? null,
      };
    }
    return invite;
  });
  return { rows, fileErrors: [] };
}

/** A starter file for admins, in the column order above. */
export const MEMBER_CSV_TEMPLATE =
  `${MEMBER_CSV_COLUMNS.join(',')}\n` +
  'kru.somsri@school.ac.th,ครูสมศรี,teacher,สมศรี ใจดี,teacher,apply_adapt,T-001\n';
