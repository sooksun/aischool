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
 *   - Breaking changes reported AND major version unchanged -> FAIL, except:
 *   - A new value in a response enum whose schema is marked `x-seip-open-enum:
 *     true` (CCR-028, owner decision A): the contract tells clients to accept
 *     unknown values there, so it is additive. oasdiff's revisionSource line
 *     must fall inside that schema's block in head — any other break still fails.
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

// Each spec is read exactly ONCE. Reading twice silently compared an EMPTY base
// when a path was a pipe (`<(git show …)`): the version check consumed it and
// oasdiff then saw nothing — "no breaking changes" for a 3.1.0 → 4.0.0 diff.
const specs = new Map();
const readSpec = (file) => {
  if (!specs.has(file)) specs.set(file, readFileSync(file));
  return specs.get(file);
};

function majorVersion(file) {
  const doc = yaml.load(readSpec(file).toString('utf8'));
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
  const dir = mkdtempSync(join(tmpdir(), 'oasdiff-'));
  if (has('oasdiff')) {
    writeFileSync(join(dir, 'base.yaml'), readSpec(base));
    writeFileSync(join(dir, 'head.yaml'), readSpec(head));
    return spawnSync('oasdiff', ['breaking', join(dir, 'base.yaml'), join(dir, 'head.yaml'), '--format', 'json'], { encoding: 'utf8' });
  }
  writeFileSync(join(dir, 'base.yaml'), readSpec(base));
  writeFileSync(join(dir, 'head.yaml'), readSpec(head));
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
// Fail closed when oasdiff itself did not run. Before this check, a docker pull
// failure (Docker Hub 429, exit 125) produced empty stdout, `|| '[]'` turned it
// into "no breaking changes", and the gate PASSED without having compared
// anything — found 2026-10-12 while diffing the 4.0.0 draft (87 real breaks
// reported as none). oasdiff prints `[]` when there is nothing to report, so
// empty output is never a valid answer.
if (result.error || ![0, 1].includes(result.status) || !result.stdout?.trim()) {
  console.error(`oasdiff did not run (status ${result.status}${result.error ? `, ${result.error.message}` : ''}) — refusing to pass unchecked`);
  console.error(result.stderr);
  process.exit(1);
}

let breaking = [];
try {
  breaking = JSON.parse(result.stdout);
} catch {
  console.error('oasdiff did not return parseable JSON:');
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(1);
}

// CCR-028: open enums. The line ranges of schemas marked x-seip-open-enum in head.
const OPEN_ENUM_IDS = new Set(['response-property-enum-value-added', 'response-body-enum-value-added']);
function openEnumRanges(file) {
  const doc = yaml.load(readSpec(file).toString('utf8'));
  const names = Object.entries(doc?.components?.schemas ?? {}).filter(([, s]) => s?.['x-seip-open-enum'] === true).map(([n]) => n);
  const lines = readSpec(file).toString('utf8').split('\n');
  const ranges = [];
  for (const name of names) {
    const start = lines.findIndex((l) => l === `    ${name}:`);
    if (start < 0) continue;
    let end = start + 1;
    while (end < lines.length && (lines[end].startsWith('     ') || lines[end].trim() === '')) end++;
    ranges.push({ name, from: start + 1, to: end }); // 1-based, inclusive
  }
  return ranges;
}
const ranges = openEnumRanges(headFile);
const excused = [];
breaking = breaking.filter((b) => {
  const line = b.revisionSource?.line;
  const hit = OPEN_ENUM_IDS.has(b.id) && typeof line === 'number' && ranges.find((r) => line >= r.from && line <= r.to);
  if (hit) excused.push(`${b.text} (open enum ${hit.name})`);
  return !hit;
});
for (const e of excused) console.log(`    open-enum value added (additive, contract-policy open-enum rule): ${e}`);

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
