#!/usr/bin/env node
/**
 * check-contract-compatibility.mjs — SEIP-QA-002 finding: the original CI step
 * ran `oasdiff breaking --fail-on ERR` unconditionally, which has no mechanism
 * to accept a deliberate, disclosed, major-version-bumped breaking change —
 * even though contract-policy.md explicitly describes that as the valid process
 * ("Breaking ... -> CCR required + major bump 2.0 + migration plan"). This
 * script implements that rule as an automated check instead of a purely
 * human-trusted one:
 *
 *   - No breaking changes reported by oasdiff              -> PASS
 *   - Breaking changes reported AND head's major version    -> PASS (logged as
 *     is greater than base's major version                    an accepted break)
 *   - Breaking changes reported AND major version unchanged -> FAIL
 *
 * Usage: node check-contract-compatibility.mjs <base.yaml> <head.yaml>
 * Requires oasdiff on PATH or via `docker run tufin/oasdiff` (same fallback
 * pattern as run-gitleaks.mjs).
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

const [baseFile, headFile] = process.argv.slice(2);
if (!baseFile || !headFile) {
  console.error('usage: check-contract-compatibility.mjs <base.yaml> <head.yaml>');
  process.exit(2);
}

function majorVersion(file) {
  const doc = yaml.load(readFileSync(file, 'utf8'));
  const v = doc?.info?.version;
  if (!v) throw new Error(`${file}: info.version missing`);
  const major = Number(String(v).split('.')[0]);
  if (!Number.isFinite(major)) throw new Error(`${file}: info.version "${v}" is not semver-like`);
  return { raw: v, major };
}

const has = (cmd) => {
  const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
  try { execSync(probe, { stdio: 'ignore', shell: true }); return true; } catch { return false; }
};

function runOasdiff(base, head) {
  const OASDIFF_DIGEST = 'tufin/oasdiff@sha256:e7f1b7531e9bbb12d61fc28c4d2a59896a47ee4fb8159eef0ff7aa76804acfb6'; // pinned, SEC-REPO-2
  if (has('oasdiff')) {
    return spawnSync('oasdiff', ['breaking', base, head, '--format', 'json'], { encoding: 'utf8' });
  }
  const dir = mkdtempSync(join(tmpdir(), 'oasdiff-'));
  writeFileSync(join(dir, 'base.yaml'), readFileSync(base));
  writeFileSync(join(dir, 'head.yaml'), readFileSync(head));
  return spawnSync(
    'docker', ['run', '--rm', '-v', `${dir}:/spec`, OASDIFF_DIGEST, 'breaking', '/spec/base.yaml', '/spec/head.yaml', '--format', 'json'],
    { encoding: 'utf8' },
  );
}

const base = majorVersion(baseFile);
const head = majorVersion(headFile);
const result = runOasdiff(baseFile, headFile);

// oasdiff exits 0 (no breaking changes) or 1 (breaking changes found) — both are
// normal outcomes here, we branch on content, not exit code. A genuine tool
// failure (e.g. bad YAML) exits with something else / empty stdout.
let breaking = [];
try {
  breaking = JSON.parse(result.stdout || '[]');
} catch {
  console.error('oasdiff did not return parseable JSON:');
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(1);
}

if (breaking.length === 0) {
  console.log(`OK  no breaking changes (${base.raw} -> ${head.raw})`);
  process.exit(0);
}

if (head.major > base.major) {
  console.log(`OK  ${breaking.length} breaking change(s) accepted — major version bumped ${base.raw} -> ${head.raw} (contract-policy.md)`);
  for (const b of breaking) console.log(`    - ${b.id ?? b.text ?? JSON.stringify(b)}`);
  process.exit(0);
}

console.error(`FAIL ${breaking.length} breaking change(s) but major version unchanged (${base.raw} -> ${head.raw})`);
console.error('     Either revert the breaking change, or bump info.version to a new major (contract-policy.md) with a CCR.');
for (const b of breaking) console.error(`    - ${b.id ?? b.text ?? JSON.stringify(b)}`);
process.exit(1);
