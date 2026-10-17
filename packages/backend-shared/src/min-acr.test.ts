import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minAcrFor } from './permissions.ts';

// Values come from docs/contracts/permissions.yaml `min_acr` (ADR-0014).
test('operation-level step-up', () => {
  assert.equal(minAcrFor('inviteMember'), 2);
  assert.equal(minAcrFor('createAssignment'), 2);
  assert.equal(minAcrFor('endMembership'), 2);
});

test('action-level step-up: validate / return need 2, revoke needs nothing extra', () => {
  assert.equal(minAcrFor('actOnMapping', 'validate'), 2);
  assert.equal(minAcrFor('actOnMapping', 'return'), 2);
  assert.equal(minAcrFor('actOnMapping', 'revoke'), 0);
});

test('an action-keyed entry asked without an action fails closed to its strictest', () => {
  assert.equal(minAcrFor('actOnMapping'), 2);
});

test('operations the contract does not name need nothing', () => {
  assert.equal(minAcrFor('listEvidence'), 0);
  assert.equal(minAcrFor('noSuchOperation'), 0);
});
