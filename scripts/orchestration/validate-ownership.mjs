#!/usr/bin/env node
/**
 * SEIP ownership validator (SEIP-OPS-001, acceptance criteria 4–8).
 *
 * Proves the invariant Sprint 0 exists to establish: every referenced path has
 * exactly one owner, so two agents can never be pointed at the same file.
 *
 * Checks
 *   1. structural — the operating-system files exist at the paths the agent
 *      instruction files name (ADR-0002 §1, findings F2/F3)
 *   2. uniqueness — no path glob is declared twice, and no module's subtree
 *      contains another module's subtree unless declared as a `carve_outs` entry
 *   3. board coverage — every `allowed_paths` entry resolves to exactly one module
 *   4. board authority — a task's owner owns every module it may write to,
 *      except declared `shared_write_paths` (ADR-0002 §4)
 *   5. instruction files — each agent's "Owned Paths" are owned by that agent
 *   6. CODEOWNERS — every module path has a rule (ADR-0002 §5)
 *
 * Exit 0 = clean. Exit 1 = at least one error. Warnings never fail the build.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseYaml } from './lib/mini-yaml.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const OWNERSHIP_FILE = '.ai-team/module-ownership.yaml';
const BOARD_FILE = '.ai-team/task-board.yaml';
const CODEOWNERS_FILE = '.github/CODEOWNERS';

/** Files that must exist at the root because a tool or a doc loads them from there. */
const REQUIRED_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'ANTIGRAVITY.md',
  'GROK.md',
  OWNERSHIP_FILE,
  BOARD_FILE,
  '.ai-team/file-locks.yaml',
  '.ai-team/team-charter.md',
  CODEOWNERS_FILE,
];

/** Instruction file -> the agent identity used on the board and in ownership. */
const AGENT_FILES = {
  'CLAUDE.md': 'claude',
  'AGENTS.md': 'codex',
  'ANTIGRAVITY.md': 'antigravity',
  'GROK.md': 'grok',
};

const errors = [];
const warnings = [];

const fail = (check, message) => errors.push({ check, message });
const warn = (check, message) => warnings.push({ check, message });

const read = (relativePath) => readFileSync(join(REPO_ROOT, relativePath), 'utf8');

/** `docs/qa/**` -> `docs/qa`; a plain file path is returned unchanged. */
const toPrefix = (glob) => glob.replace(/\/\*\*$/, '').replace(/^\.\//, '').replace(/\/+$/, '');

/** True when `candidate` is `prefix` itself or lives inside it. */
const isCovered = (candidate, prefix) => {
  const c = toPrefix(candidate);
  return c === prefix || c.startsWith(`${prefix}/`);
};

// ---------------------------------------------------------------- check 1
for (const file of REQUIRED_FILES) {
  if (!existsSync(join(REPO_ROOT, file))) {
    fail('structure', `${file} is missing — an agent instruction file references it at this path`);
  }
}
if (errors.length > 0) {
  report();
  process.exit(1);
}

const ownership = parseYaml(read(OWNERSHIP_FILE));
const board = parseYaml(read(BOARD_FILE));

// ---------------------------------------------------------------- check 2
/** @type {{glob: string, prefix: string, module: string, owner: string, reviewer: string}[]} */
const owned = [];
const modules = ownership.modules ?? {};

for (const [moduleName, module] of Object.entries(modules)) {
  if (!module?.owner) fail('ownership', `module "${moduleName}" has no owner`);
  if (!module?.reviewer) fail('ownership', `module "${moduleName}" has no reviewer`);
  if (module?.owner && module.owner === module.reviewer) {
    fail('ownership', `module "${moduleName}" has the same agent as owner and reviewer — no independent check`);
  }
  for (const glob of module?.paths ?? []) {
    owned.push({
      glob,
      prefix: toPrefix(glob),
      module: moduleName,
      owner: module.owner,
      reviewer: module.reviewer,
    });
  }
}

if (owned.length === 0) fail('ownership', `${OWNERSHIP_FILE} declares no paths`);

/** Carve-out pairs whose CODEOWNERS ordering must be verified in check 6. */
const carveOutOrder = [];

const carveOuts = new Set(ownership.carve_outs ?? []);
for (const glob of carveOuts) {
  if (!owned.some((entry) => entry.glob === glob)) {
    fail('ownership', `carve_outs lists ${glob}, which no module declares`);
  }
}

for (let i = 0; i < owned.length; i++) {
  for (let j = i + 1; j < owned.length; j++) {
    const a = owned[i];
    const b = owned[j];
    if (!isCovered(a.prefix, b.prefix) && !isCovered(b.prefix, a.prefix)) continue;

    if (a.module === b.module) {
      warn('ownership', `${a.glob} and ${b.glob} overlap inside module "${a.module}" — redundant, not a collision`);
      continue;
    }
    if (a.prefix === b.prefix) {
      fail('ownership', `${a.glob} is claimed by both "${a.module}" and "${b.module}" — a path may have only one owner`);
      continue;
    }

    // One contains the other. Legal only when the narrower path is a declared
    // carve-out, and only if CODEOWNERS lists it after the broader rule.
    const [broader, narrower] = isCovered(b.prefix, a.prefix) ? [a, b] : [b, a];
    if (!carveOuts.has(narrower.glob)) {
      fail(
        'ownership',
        `${narrower.glob} ("${narrower.module}", owner ${narrower.owner}) sits inside ${broader.glob} ` +
          `("${broader.module}", owner ${broader.owner}) — declare it under carve_outs if that is intended`,
      );
      continue;
    }
    carveOutOrder.push({ broader, narrower });
  }
}

/** Resolve a path to its owning entry, preferring the most specific match. */
const ownerOf = (path) => {
  const matches = owned.filter((entry) => isCovered(path, entry.prefix));
  if (matches.length === 0) return null;
  return matches.reduce((best, entry) => (entry.prefix.length > best.prefix.length ? entry : best));
};

const sharedWritePaths = (ownership.shared_write_paths ?? []).map(toPrefix);
const isSharedWrite = (path) => sharedWritePaths.some((prefix) => isCovered(path, prefix));

// ------------------------------------------------------------- checks 3, 4
for (const task of board.tasks ?? []) {
  const id = task.id ?? '<unnamed task>';

  for (const path of task.allowed_paths ?? []) {
    const entry = ownerOf(path);
    if (!entry) {
      fail('board', `${id}: allowed path ${path} has no owner in ${OWNERSHIP_FILE}`);
      continue;
    }
    if (entry.owner !== task.owner && !isSharedWrite(path)) {
      fail(
        'board',
        `${id}: owner is "${task.owner}" but ${path} belongs to module "${entry.module}" owned by "${entry.owner}" ` +
          `— assign the task to the module owner or declare the path in shared_write_paths`,
      );
    }
  }

  // Blocked paths are intentionally broad (e.g. `apps/**` spans two modules),
  // so they are not required to resolve to a single owner.
  for (const path of task.blocked_paths ?? []) {
    if (task.allowed_paths?.some((allowed) => isCovered(allowed, toPrefix(path)))) {
      fail('board', `${id}: ${path} is both allowed and blocked`);
    }
  }

  if (task.work_order && !existsSync(join(REPO_ROOT, task.work_order))) {
    fail('board', `${id}: work order ${task.work_order} does not exist`);
  }

  const statuses = board.statuses ?? [];
  if (statuses.length > 0 && task.status && !statuses.includes(task.status)) {
    fail('board', `${id}: status "${task.status}" is not one of the declared statuses`);
  }

  for (const dependency of task.dependencies ?? []) {
    if (!(board.tasks ?? []).some((other) => other.id === dependency)) {
      fail('board', `${id}: depends on ${dependency}, which is not on the board`);
    }
  }
}

// ---------------------------------------------------------------- check 5
for (const [file, agent] of Object.entries(AGENT_FILES)) {
  const body = read(file);
  // `$(?![\s\S])` is end-of-input — JS has no \Z, and plain `$` under /m would
  // stop at the first line break.
  const section = body.match(/^##\s+Owned Paths\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
  if (!section) {
    warn('instructions', `${file} has no "## Owned Paths" section to cross-check`);
    continue;
  }
  const paths = [...section[1].matchAll(/^-\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
  if (paths.length === 0) warn('instructions', `${file} lists no owned paths`);

  for (const path of paths) {
    const entry = ownerOf(path);
    if (!entry) {
      fail('instructions', `${file} claims ${path}, which has no owner in ${OWNERSHIP_FILE}`);
    } else if (entry.owner !== agent) {
      fail(
        'instructions',
        `${file} claims ${path}, but ${OWNERSHIP_FILE} gives it to "${entry.owner}" via module "${entry.module}"`,
      );
    }
  }
}

// ---------------------------------------------------------------- check 6
const codeownerPatterns = read(CODEOWNERS_FILE)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => line.split(/\s+/)[0]);

const rulePosition = (glob) => codeownerPatterns.indexOf(glob.startsWith('/') ? glob : `/${glob}`);

for (const entry of owned) {
  if (rulePosition(entry.glob) === -1) {
    fail('codeowners', `${CODEOWNERS_FILE} has no rule for /${entry.glob} (module "${entry.module}")`);
  }
}

// GitHub applies the *last* matching CODEOWNERS rule, so a carve-out listed
// before the subtree it carves out of is silently overridden.
for (const { broader, narrower } of carveOutOrder) {
  const broaderAt = rulePosition(broader.glob);
  const narrowerAt = rulePosition(narrower.glob);
  if (broaderAt === -1 || narrowerAt === -1) continue;
  if (narrowerAt < broaderAt) {
    fail(
      'codeowners',
      `/${narrower.glob} is listed before /${broader.glob} in ${CODEOWNERS_FILE} — the last matching rule wins, ` +
        `so the carve-out would be overridden. Move it after the broader rule.`,
    );
  }
}

// ----------------------------------------------------------------- report
function report() {
  for (const { check, message } of warnings) console.warn(`warn  [${check}] ${message}`);
  for (const { check, message } of errors) console.error(`ERROR [${check}] ${message}`);

  if (errors.length === 0) {
    console.log(
      `ownership OK — ${owned?.length ?? 0} owned paths across ${Object.keys(modules ?? {}).length} modules, ` +
        `${(board?.tasks ?? []).length} tasks on the board, ${warnings.length} warning(s)`,
    );
  } else {
    console.error(`\n${errors.length} ownership error(s). See ADR-0002 for the precedence rule.`);
  }
}

report();
process.exit(errors.length === 0 ? 0 : 1);
