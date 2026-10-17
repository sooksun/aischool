import { describe, expect, it } from 'vitest';
import { membersFromCsv, parseCsv } from './memberCsv';

describe('parseCsv', () => {
  it('handles quotes, embedded commas and newlines, CRLF and a BOM', () => {
    const text = '﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z\r\n\r\n';
    expect(parseCsv(text)).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']]);
  });
});

describe('membersFromCsv', () => {
  it('maps columns by header, in any order, and builds personnel only when given', () => {
    const { rows, fileErrors } = membersFromCsv(
      'Role,EMAIL,display_name,full_name,position_role,rank_level_code\n' +
      'teacher,a@x.io,ครูเอ,เอ ใจดี,teacher,apply_adapt\n' +
      'evaluator,b@x.io,กรรมการบี,,,\n',
    );
    expect(fileErrors).toEqual([]);
    expect(rows[0]).toEqual({
      email: 'a@x.io', display_name: 'ครูเอ', role: 'teacher',
      personnel: { full_name: 'เอ ใจดี', position_role: 'teacher', rank_level_code: 'apply_adapt', employee_code: null },
    });
    expect(rows[1]).toEqual({ email: 'b@x.io', display_name: 'กรรมการบี', role: 'evaluator' });
  });

  it('reports missing required columns as a file error', () => {
    expect(membersFromCsv('email,role\na@x.io,teacher\n').fileErrors).toEqual(['ไม่พบคอลัมน์ display_name']);
    expect(membersFromCsv('').fileErrors).toEqual(['ไฟล์ว่าง']);
  });
});
