import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTenancy, hasSchoolRole, hasAreaReadAccess } from './role-resolution.ts';

const NOW = new Date('2026-07-17T00:00:00Z');
const row = (over: Partial<Parameters<typeof resolveTenancy>[1][number]> = {}) => ({
  role: 'teacher' as const,
  membershipScope: 'school' as const,
  schoolId: 'school-1',
  areaId: null,
  status: 'active',
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  ...over,
});

test('active school membership grants the role at that school only', () => {
  const ctx = resolveTenancy('u1', [row()], NOW);
  assert.ok(hasSchoolRole(ctx, 'school-1', 'teacher'));
  assert.equal(hasSchoolRole(ctx, 'school-2', 'teacher'), false);
  assert.equal(hasSchoolRole(ctx, 'school-1', 'director'), false);
});

test('inactive status is excluded (SEC-AUTH-3: disabled must not authorize)', () => {
  const ctx = resolveTenancy('u1', [row({ status: 'inactive' })], NOW);
  assert.equal(hasSchoolRole(ctx, 'school-1', 'teacher'), false);
});

test('future effectiveFrom and past effectiveTo are excluded', () => {
  const future = row({ effectiveFrom: new Date('2027-01-01') });
  const expired = row({ effectiveTo: new Date('2026-01-01') });
  const ctx = resolveTenancy('u1', [future, expired], NOW);
  assert.equal(hasSchoolRole(ctx, 'school-1', 'teacher'), false);
});

test('area_admin membership grants area-read, not a school role', () => {
  const ctx = resolveTenancy('u1', [
    row({ role: 'area_admin', membershipScope: 'area', schoolId: null, areaId: 'area-1' }),
  ], NOW);
  assert.equal(hasSchoolRole(ctx, 'school-1', 'area_admin'), false); // not a school-scoped grant
  assert.ok(hasAreaReadAccess(ctx, 'area-1'));
  assert.equal(hasAreaReadAccess(ctx, 'area-2'), false);
  assert.equal(hasAreaReadAccess(ctx, null), false); // school with no area assigned
});

test('a user can hold different roles at different schools simultaneously', () => {
  const ctx = resolveTenancy('u1', [
    row({ schoolId: 'school-1', role: 'teacher' }),
    row({ schoolId: 'school-2', role: 'director' }),
  ], NOW);
  assert.ok(hasSchoolRole(ctx, 'school-1', 'teacher'));
  assert.ok(hasSchoolRole(ctx, 'school-2', 'director'));
  assert.equal(hasSchoolRole(ctx, 'school-1', 'director'), false);
});
