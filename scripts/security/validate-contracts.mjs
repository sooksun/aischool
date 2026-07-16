#!/usr/bin/env node
/**
 * validate-contracts.mjs — SEIP contract-validity gate (SEIP-QA-001, extended by ARCH-002)
 *
 * 1. redocly lint on openapi.yaml (errors fail; warnings tolerated)
 * 2. openapi-typescript generation smoke (proves the codegen path ADR-0001 relies on)
 * 3. YAML parse of permissions/events/error-codes via js-yaml
 * 4. authz coverage: every operationId has a row in the permissions.yaml matrix
 *    (SEC-TEN-5 — an endpoint must never ship without a documented authz rule)
 *
 * Uses npx with pinned majors — no repo dependencies required.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let failed = false;
const step = (label, fn) => {
  try { fn(); console.log(`OK  ${label}`); }
  catch { console.error(`FAIL ${label}`); failed = true; }
};

step('openapi lint', () =>
  run(`${NPX} --yes @redocly/cli@2 lint docs/contracts/openapi.yaml`));

step('openapi typegen', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'seip-types-')), 'api.d.ts');
  run(`${NPX} --yes openapi-typescript@7 docs/contracts/openapi.yaml -o "${out}"`);
});

for (const f of ['permissions', 'events', 'error-codes']) {
  step(`yaml parse ${f}.yaml`, () =>
    run(`${NPX} --yes js-yaml@4 docs/contracts/${f}.yaml > ${process.platform === 'win32' ? 'NUL' : '/dev/null'}`));
}

step('authz coverage (every operationId has a reviewed rule)', () => {
  const api = readFileSync('docs/contracts/openapi.yaml', 'utf8');
  const perms = readFileSync('docs/contracts/permissions.yaml', 'utf8');

  const ops = [...api.matchAll(/^\s{6}operationId:\s*(\S+)/gm)].map((m) => m[1]);
  if (ops.length === 0) throw new Error('no operationIds found — parser assumption broke');

  // An operation is covered by a role rule in `matrix:`, or by an explicit
  // exemption in `unauthenticated:` / `any_authenticated:`. Exemptions are
  // decisions, not omissions — that is the point of listing them.
  const section = (name, endsAt) =>
    perms.split(new RegExp(`^${name}:$`, 'm'))[1]?.split(new RegExp(`^(?:${endsAt}):`, 'm'))[0] ?? '';
  const keys = (body) => [...body.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);

  const byMatrix = keys(section('matrix', 'notes'));
  const exempt = [
    ...keys(section('unauthenticated', 'any_authenticated|matrix')),
    ...keys(section('any_authenticated', 'matrix|notes')),
  ];
  const covered = new Set([...byMatrix, ...exempt]);

  console.log(`    ${ops.length} operations · ${byMatrix.length} matrix rules · ${exempt.length} explicit exemptions`);
  const missing = ops.filter((op) => !covered.has(op));
  if (missing.length) throw new Error(`operations with no authz rule: ${missing.join(', ')}`);

  const orphans = [...covered].filter((c) => !ops.includes(c));
  if (orphans.length) console.warn(`    warning: rules with no matching operation: ${orphans.join(', ')}`);
});

process.exit(failed ? 1 : 0);
