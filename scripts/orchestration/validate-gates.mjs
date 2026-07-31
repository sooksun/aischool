#!/usr/bin/env node
/**
 * SEIP gate-coverage validator (SEIP-OPS-001, acceptance criterion 9).
 *
 * docs/qa/QUALITY-GATES.md is the gate list; .github/workflows/ is the wiring.
 * Those two are owned by different agents (grok owns the gates, claude owns the
 * CI), which is exactly the seam where a gate goes missing without anyone
 * noticing. This script fails the build if they disagree in either direction:
 *
 *   - a gate in the document with no job    -> the gate is not enforced
 *   - a job with no gate in the document    -> CI enforces something unwritten
 *
 * Job names are matched to gate names case- and punctuation-insensitively, so
 * "End-to-end tests" in the doc matches the "End-to-end tests" job regardless of
 * hyphenation drift.
 *
 * Workflow files are read with regexes rather than a YAML parser on purpose:
 * only the job ids and their `name:` fields matter here, and GitHub Actions
 * syntax (`${{ }}`, `on:`) is more than the minimal parser in ./lib should be
 * asked to swallow.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATES_DOC = 'docs/qa/QUALITY-GATES.md';

/** Which document section each workflow is responsible for covering. */
const WORKFLOWS = [
  { section: 'Pull Request Gates', file: '.github/workflows/pr-gates.yml' },
  { section: 'Release Gates', file: '.github/workflows/release-gates.yml' },
];

/** Jobs that exist for reasons other than covering a documented gate. */
const NON_GATE_JOBS = new Set(['Orchestration integrity']);

const errors = [];
const read = (relativePath) => readFileSync(join(REPO_ROOT, relativePath), 'utf8');
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Bullet items under a `## <heading>` section, up to the next `##`. */
function gatesInSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `$(?![\s\S])` is end-of-input; plain `$` under /m would stop at the first
  // line break, and JS has no \Z.
  const section = markdown.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'm'));
  if (!section) return null;
  return [...section[1].matchAll(/^-\s+(.+?)\s*$/gm)].map((match) => match[1]);
}

/** Job display names in a workflow: the `name:` of each top-level job. */
function jobNamesIn(workflow) {
  const jobsBlock = workflow.match(/^jobs:\s*$([\s\S]*)$/m);
  if (!jobsBlock) return null;

  const names = [];
  const lines = jobsBlock[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const jobId = lines[i].match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
    if (!jobId) continue;

    // The job's own `name:` — the first one at the job's property indent,
    // before the next job starts. Falls back to the job id, as GitHub does.
    let name = jobId[1];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^ {2}[A-Za-z_][\w-]*:\s*$/.test(lines[j])) break;
      const nameLine = lines[j].match(/^ {4}name:\s+(.+?)\s*$/);
      if (nameLine) {
        name = nameLine[1].replace(/^['"]|['"]$/g, '');
        break;
      }
    }
    names.push(name);
  }
  return names;
}

if (!existsSync(join(REPO_ROOT, GATES_DOC))) {
  console.error(`ERROR [gates] ${GATES_DOC} is missing`);
  process.exit(1);
}

const gatesDoc = read(GATES_DOC);
let gateCount = 0;
let jobCount = 0;

for (const { section, file } of WORKFLOWS) {
  if (!existsSync(join(REPO_ROOT, file))) {
    errors.push(`[gates] ${file} is missing — "${section}" has no workflow`);
    continue;
  }

  const gates = gatesInSection(gatesDoc, section);
  if (gates === null) {
    errors.push(`[gates] ${GATES_DOC} has no "## ${section}" section`);
    continue;
  }
  if (gates.length === 0) {
    errors.push(`[gates] "${section}" in ${GATES_DOC} lists no gates`);
    continue;
  }

  const jobNames = jobNamesIn(read(file));
  if (jobNames === null) {
    errors.push(`[gates] ${file} has no jobs: block`);
    continue;
  }

  const gateJobs = jobNames.filter((name) => !NON_GATE_JOBS.has(name));
  const jobKeys = new Set(gateJobs.map(normalize));
  const gateKeys = new Set(gates.map(normalize));

  for (const gate of gates) {
    if (!jobKeys.has(normalize(gate))) {
      errors.push(`[gates] "${gate}" (${section}) has no job in ${file}`);
    }
  }
  for (const job of gateJobs) {
    if (!gateKeys.has(normalize(job))) {
      errors.push(`[gates] job "${job}" in ${file} is not a gate in ${GATES_DOC}`);
    }
  }

  gateCount += gates.length;
  jobCount += gateJobs.length;
}

for (const message of errors) console.error(`ERROR ${message}`);

if (errors.length === 0) {
  console.log(`gates OK — ${gateCount} documented gates covered by ${jobCount} jobs across ${WORKFLOWS.length} workflows`);
  process.exit(0);
}
console.error(`\n${errors.length} gate-coverage error(s). Gate list: ${GATES_DOC}.`);
process.exit(1);
