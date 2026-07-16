#!/usr/bin/env node
/**
 * validate-ownership.mjs — SEIP orchestration gate (SEIP-OPS-001)
 *
 * Checks the multi-agent ownership model is internally consistent:
 *   1. every module has exactly one owner and one reviewer
 *   2. no path glob is owned by two modules
 *   3. every task allowed_path on the board falls under some owned glob
 *   4. (info) cross-owner grants: task owner differs from the module owner
 *
 * Zero-dependency by design: parses only the restricted YAML shape used by
 * .ai-team/module-ownership.yaml and .ai-team/task-board.yaml. If those files
 * grow beyond simple `key: value` + `- item` lists, switch to a real parser.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8').split(/\r?\n/);

const stripComment = (s) => s.replace(/\s+#.*$/, '').trim();

function parseOwnership(lines) {
  const modules = {};
  let cur = null, inPaths = false;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = stripComment(raw);
    if (indent === 2 && line.endsWith(':')) {
      cur = line.slice(0, -1);
      modules[cur] = { owner: null, reviewer: null, paths: [] };
      inPaths = false;
    } else if (cur && indent === 4) {
      if (line === 'paths:') inPaths = true;
      else {
        const [k, v] = line.split(/:\s*/);
        if (k === 'owner') { modules[cur].owner = v; inPaths = false; }
        if (k === 'reviewer') { modules[cur].reviewer = v; inPaths = false; }
      }
    } else if (cur && inPaths && line.startsWith('- ')) {
      modules[cur].paths.push(line.slice(2).trim());
    }
  }
  return modules;
}

function parseBoardTasks(lines) {
  const tasks = [];
  let cur = null, field = null;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = stripComment(raw);
    if (indent === 2 && line.startsWith('- id:')) {
      cur = { id: line.replace('- id:', '').trim(), owner: null, allowed_paths: [] };
      tasks.push(cur); field = null;
    } else if (cur && indent === 4) {
      if (line.startsWith('owner:')) cur.owner = line.replace('owner:', '').trim();
      field = line === 'allowed_paths:' ? 'allowed' : (line.endsWith(':') ? 'other' : field);
    } else if (cur && field === 'allowed' && indent === 6 && line.startsWith('- ')) {
      cur.allowed_paths.push(line.slice(2).trim());
    }
  }
  return tasks;
}

// glob containment for our restricted patterns: "dir/**" or exact file paths
const globPrefix = (g) => g.endsWith('/**') ? g.slice(0, -2) : g; // keep trailing '/'
function coveredBy(taskGlob, ownGlob) {
  if (ownGlob === taskGlob) return true;
  if (!ownGlob.endsWith('/**')) return false;
  return taskGlob.startsWith(globPrefix(ownGlob));
}

const modules = parseOwnership(read('.ai-team/module-ownership.yaml'));
const tasks = parseBoardTasks(read('.ai-team/task-board.yaml'));

const errors = [], warnings = [], info = [];

// 1. owner/reviewer present
for (const [name, m] of Object.entries(modules)) {
  if (!m.owner) errors.push(`module '${name}' has no owner`);
  if (!m.reviewer) errors.push(`module '${name}' has no reviewer`);
  if (m.owner && m.reviewer && m.owner === m.reviewer)
    errors.push(`module '${name}': owner and reviewer are both '${m.owner}' — no independent review`);
}

// 2. no double ownership
const allGlobs = Object.entries(modules).flatMap(([name, m]) => m.paths.map(p => ({ name, p })));
for (let i = 0; i < allGlobs.length; i++)
  for (let j = i + 1; j < allGlobs.length; j++) {
    const a = allGlobs[i], b = allGlobs[j];
    if (a.name !== b.name && (coveredBy(a.p, b.p) || coveredBy(b.p, a.p)))
      errors.push(`double ownership: '${a.p}' (${a.name}) overlaps '${b.p}' (${b.name})`);
  }

// 3+4. task allowed_paths coverage
const rootFiles = ['CLAUDE.md', 'AGENTS.md', 'ANTIGRAVITY.md', 'GROK.md', '.gitignore', '.gitattributes'];
for (const t of tasks) {
  for (const tp of t.allowed_paths) {
    if (rootFiles.includes(tp) || tp === '/') { info.push(`${t.id}: root-level grant '${tp}' (bootstrap scope)`); continue; }
    const owners = allGlobs.filter(g => coveredBy(tp, g.p));
    if (owners.length === 0) { warnings.push(`${t.id}: allowed_path '${tp}' is not covered by any owned module path`); continue; }
    const foreign = owners.filter(o => modules[o.name].owner !== t.owner);
    if (foreign.length && !owners.some(o => modules[o.name].owner === t.owner))
      info.push(`${t.id}: cross-owner grant — '${tp}' owned by ${[...new Set(foreign.map(f => modules[f.name].owner))].join(', ')}, task owner ${t.owner} (module owner still reviews)`);
  }
}

for (const e of errors) console.error(`ERROR   ${e}`);
for (const w of warnings) console.error(`WARNING ${w}`);
for (const i of info) console.log(`info    ${i}`);
console.log(`\nownership: ${Object.keys(modules).length} modules, ${allGlobs.length} globs; board: ${tasks.length} tasks — ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
