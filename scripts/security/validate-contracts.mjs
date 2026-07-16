#!/usr/bin/env node
/**
 * validate-contracts.mjs — SEIP contract-validity gate (SEIP-QA-001)
 *
 * 1. redocly lint on openapi.yaml (errors fail; warnings tolerated)
 * 2. openapi-typescript generation smoke (proves the codegen path ADR-0001 relies on)
 * 3. YAML parse of permissions/events/error-codes via js-yaml
 *
 * Uses npx with pinned majors — no repo dependencies required.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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

process.exit(failed ? 1 : 0);
