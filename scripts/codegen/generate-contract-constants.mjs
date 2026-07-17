#!/usr/bin/env node
/**
 * generate-contract-constants.mjs — packages/backend-shared codegen
 *
 * error-codes.yaml and events.yaml are the single source of truth (contract-policy.md).
 * Hand-duplicating their codes/names into TypeScript would let the two drift — the
 * exact failure mode SEC-TEN-5 exists to prevent for permissions.yaml. This script
 * generates instead of hand-authors, and `gate:contracts` (extended below) fails the
 * build if the committed output doesn't match a fresh run.
 *
 * Output is committed (not .gitignored) so packages/backend-shared builds without
 * requiring codegen as a install step — codegen only re-runs when a contract changes.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const load = (p) => yaml.load(read(p));

const HEADER = (source) => `// GENERATED FILE — do not edit by hand.
// Source of truth: docs/contracts/${source} (version pinned below).
// Regenerate: npm run codegen:contracts
// Drift check: npm run gate:contracts (fails CI if this file disagrees with the source)
`;

function generateErrorCodes() {
  const doc = load('docs/contracts/error-codes.yaml');
  const entries = Object.entries(doc.codes);

  const unionType = entries.map(([code]) => `  | '${code}'`).join('\n');
  const table = entries
    .map(([code, { http, meaning }]) =>
      `  '${code}': { http: ${http}, meaning: ${JSON.stringify(meaning)} },`)
    .join('\n');

  const out = `${HEADER('error-codes.yaml')}
export const ERROR_CODES_VERSION = '${doc.version}';

export type ErrorCode =
${unionType};

export const ERROR_CODE_TABLE: Record<ErrorCode, { http: number; meaning: string }> = {
${table}
};

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CODE_TABLE[code].http;
}
`;
  writeOut('packages/backend-shared/src/error-codes.generated.ts', out);
  return entries.length;
}

function generateEvents() {
  const doc = load('docs/contracts/events.yaml');
  const entries = Object.entries(doc.events);

  // events.yaml payload types are a small hand-parseable subset (uuid, string,
  // integer, number, boolean, 'enum[a, b]', 'uuid[3]', 'x|null'). Map to TS.
  function tsType(raw) {
    let t = String(raw).trim();
    const nullable = t.endsWith('|null');
    if (nullable) t = t.slice(0, -'|null'.length).trim();
    let base;
    if (t === 'uuid' || t === 'string') base = 'string';
    else if (t === 'integer' || t === 'number') base = 'number';
    else if (t === 'boolean') base = 'boolean';
    else if (t === 'iso8601') base = 'string';
    else if (/^enum\[(.+)]$/.test(t)) {
      const opts = t.match(/^enum\[(.+)]$/)[1].split(',').map((s) => `'${s.trim()}'`);
      base = opts.join(' | ');
    } else if (/^uuid\[(\d+)]$/.test(t)) {
      base = 'string[]'; // fixed-length noted only in the YAML comment, not the type system
    } else {
      base = 'unknown';
    }
    return nullable ? `${base} | null` : base;
  }

  const eventNameUnion = entries.map(([name]) => `  | '${name}'`).join('\n');

  const payloadInterfaces = entries
    .map(([name, def]) => {
      const ifaceName = 'Event_' + name.replace(/[.]/g, '_');
      const fields = Object.entries(def.payload ?? {})
        .map(([k, v]) => `  ${k}: ${tsType(v)};`)
        .join('\n');
      return `export interface ${ifaceName} {\n${fields}\n}`;
    })
    .join('\n\n');

  const payloadMapEntries = entries
    .map(([name]) => `  '${name}': Event_${name.replace(/[.]/g, '_')};`)
    .join('\n');

  const out = `${HEADER('events.yaml')}
export const EVENTS_VERSION = '${doc.version}';

export type EventType =
${eventNameUnion};

${payloadInterfaces}

export interface EventPayloadMap {
${payloadMapEntries}
}

/** Envelope fields required on every emitted event (events.yaml #envelope). */
export interface EventEnvelope<T extends EventType> {
  event_id: string;
  event_type: T;
  schema_version: number;
  occurred_at: string;
  school_id: string | null;
  actor_user_id: string | null;
  request_id?: string;
  payload: EventPayloadMap[T];
}
`;
  writeOut('packages/backend-shared/src/events.generated.ts', out);
  return entries.length;
}

function writeOut(relPath, content) {
  const full = resolve(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

const codeCount = generateErrorCodes();
const eventCount = generateEvents();
console.log(`generated ${codeCount} error codes, ${eventCount} event types`);
