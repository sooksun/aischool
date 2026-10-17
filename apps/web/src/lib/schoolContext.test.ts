import { describe, expect, it } from 'vitest';
import { pickSchool, schoolOptions } from './schoolContext';

const m = (school_id: string, school_name: string, role: 'teacher' | 'evaluator' = 'teacher') =>
  ({ role, membership_scope: 'school' as const, school_id, school_name, area_id: null });

describe('school context (FR-019)', () => {
  it('one option per school, area memberships ignored', () => {
    expect(schoolOptions([m('a', 'ก'), m('a', 'ก', 'evaluator'), m('b', 'ข'),
      { role: 'area_admin', membership_scope: 'area', school_id: null, area_id: 'x' }])).toEqual([
      { id: 'a', name: 'ก' }, { id: 'b', name: 'ข' },
    ]);
  });

  it('one school is chosen for you; several use the remembered one only if it is still yours', () => {
    expect(pickSchool([{ id: 'a', name: 'ก' }], null)).toBe('a');
    const two = [{ id: 'a', name: 'ก' }, { id: 'b', name: 'ข' }];
    expect(pickSchool(two, 'b')).toBe('b');
    expect(pickSchool(two, 'gone')).toBeNull();
    expect(pickSchool(two, null)).toBeNull();
  });
});
