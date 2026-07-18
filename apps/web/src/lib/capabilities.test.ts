import { describe, expect, it } from 'vitest';
import { capabilitiesFromMemberships, CAPABILITY_ROLES } from './capabilities';
import type { components } from '../api/schema.generated';

type Role = components['schemas']['Role'];

function m(role: Role) {
  return {
    school_id: '00000000-0000-0000-0000-000000000001',
    area_id: null,
    role,
    membership_scope: 'school' as const,
  };
}

describe('capabilitiesFromMemberships', () => {
  it('returns all false for empty memberships', () => {
    const c = capabilitiesFromMemberships([]);
    expect(c.manageCycles).toBe(false);
    expect(c.viewReports).toBe(false);
    expect(c.scoreAsCommittee).toBe(false);
  });

  it('teacher: view reports, not manage cycles or score as committee', () => {
    const c = capabilitiesFromMemberships([m('teacher')]);
    expect(c.viewReports).toBe(true);
    expect(c.manageCycles).toBe(false);
    expect(c.scoreAsCommittee).toBe(false);
    expect(c.createReports).toBe(false);
    expect(c.governMappings).toBe(false);
  });

  it('director: cycles, scores, reports, govern', () => {
    const c = capabilitiesFromMemberships([m('director')]);
    expect(c.manageCycles).toBe(true);
    expect(c.scoreAsCommittee).toBe(true);
    expect(c.viewReports).toBe(true);
    expect(c.createReports).toBe(true);
    expect(c.governMappings).toBe(true);
  });

  it('evaluator: score + view reports, not manage cycles', () => {
    const c = capabilitiesFromMemberships([m('evaluator')]);
    expect(c.scoreAsCommittee).toBe(true);
    expect(c.viewReports).toBe(true);
    expect(c.manageCycles).toBe(false);
    expect(c.createReports).toBe(false);
  });

  it('area_admin: view reports (listReports area-r), not create', () => {
    const c = capabilitiesFromMemberships([m('area_admin')]);
    expect(c.viewReports).toBe(true);
    expect(c.createReports).toBe(false);
    expect(c.manageCycles).toBe(false);
  });

  it('unions roles across memberships', () => {
    const c = capabilitiesFromMemberships([m('teacher'), m('evaluator')]);
    expect(c.viewReports).toBe(true);
    expect(c.scoreAsCommittee).toBe(true);
    expect(c.manageCycles).toBe(false);
  });

  // submitEvidence drives the "+ ส่งหลักฐาน" nav entry. It must mirror the
  // createEvidence row in permissions.yaml — showing it to a role the API will
  // reject is a dead end, hiding it from a role that owns evidence is the
  // discoverability bug this capability was added to fix.
  it('submitEvidence: exactly the roles createEvidence grants', () => {
    for (const role of ['teacher', 'deputy', 'director', 'school_admin'] as Role[]) {
      expect(capabilitiesFromMemberships([m(role)]).submitEvidence).toBe(true);
    }
    for (const role of ['evaluator', 'area_admin'] as Role[]) {
      expect(capabilitiesFromMemberships([m(role)]).submitEvidence).toBe(false);
    }
    expect(capabilitiesFromMemberships([]).submitEvidence).toBe(false);
  });

  it('CAPABILITY_ROLES lists only known Role values', () => {
    const known: Role[] = ['teacher', 'director', 'deputy', 'evaluator', 'school_admin', 'area_admin'];
    for (const roles of Object.values(CAPABILITY_ROLES)) {
      for (const r of roles) {
        expect(known).toContain(r);
      }
    }
  });
});
