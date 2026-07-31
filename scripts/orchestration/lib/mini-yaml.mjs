/**
 * Minimal YAML reader for the `.ai-team/*.yaml` operating-system files.
 *
 * The repo has no package.json yet (ADR-0001 stack is decided but Sprint 0
 * forbids feature code), so orchestration scripts must run on a bare Node
 * install with zero dependencies. This parser covers exactly the subset the
 * operating-system files use:
 *
 *   - nested block mappings
 *   - block sequences of scalars and of mappings
 *   - empty and scalar-only flow sequences (`[]`, `[a, b]`)
 *   - `#` comments, whole-line and trailing
 *   - folded/literal block scalars (`>`, `|`, and their chomping variants),
 *     whose bodies are discarded — no check reads prose values
 *
 * It is deliberately strict: anything outside that subset throws rather than
 * being silently misread, because a misread ownership file would defeat the
 * point of the validator.
 */

const BLOCK_SCALAR = /^(.*?):\s*[|>][-+]?\d*\s*$/;
const KEY_VALUE = /^([^:]+):(?:\s+(.*))?$/;

function stripTrailingComment(content) {
  // Only a `#` preceded by whitespace starts a comment; `a#b` is a scalar.
  const match = content.match(/(^|\s)#/);
  if (!match) return content;
  if (match.index === 0 && match[1] === '') return '';
  return content.slice(0, match.index + match[1].length).trimEnd();
}

/** `[]` -> [], `[a, b]` -> ['a', 'b']. Returns null when not a flow sequence. */
function parseFlowSequence(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return [];
  if (inner.includes('[') || inner.includes('{')) {
    throw new Error(`nested flow collections are not supported: ${trimmed}`);
  }
  return inner.split(',').map((item) => unquote(item));
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/** Split source into significant lines, dropping comments and block-scalar bodies. */
function tokenize(source) {
  const rawLines = source.split(/\r?\n/);
  const lines = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;

    const indent = raw.length - raw.trimStart().length;
    const content = stripTrailingComment(raw.slice(indent)).trimEnd();
    if (content === '') continue;

    const blockScalar = content.match(BLOCK_SCALAR);
    if (blockScalar) {
      // Keep the key so the mapping stays well-formed, drop the folded body.
      lines.push({ indent, content: `${blockScalar[1]}: ""`, line: i + 1 });
      while (i + 1 < rawLines.length) {
        const next = rawLines[i + 1];
        if (next.trim() === '') { i++; continue; }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent <= indent) break;
        i++;
      }
      continue;
    }

    lines.push({ indent, content, line: i + 1 });
  }

  return lines;
}

function parseMapping(lines, start, indent) {
  const result = {};
  let i = start;

  while (i < lines.length && lines[i].indent >= indent) {
    const current = lines[i];
    if (current.indent > indent) {
      throw new Error(`line ${current.line}: unexpected indentation in mapping`);
    }
    if (current.content.startsWith('- ')) break;

    const match = current.content.match(KEY_VALUE);
    if (!match) throw new Error(`line ${current.line}: expected "key: value", got ${current.content}`);

    const key = match[1].trim();
    const inlineValue = match[2] === undefined ? '' : match[2].trim();
    i++;

    if (inlineValue !== '') {
      const flow = parseFlowSequence(inlineValue);
      result[key] = flow === null ? unquote(inlineValue) : flow;
      continue;
    }

    const next = lines[i];
    if (!next) { result[key] = null; continue; }

    if (next.indent > indent) {
      const [value, consumed] = parseNode(lines, i, next.indent);
      result[key] = value;
      i = consumed;
    } else if (next.indent === indent && next.content.startsWith('- ')) {
      // A sequence may sit at the same indentation as its key.
      const [value, consumed] = parseSequence(lines, i, indent);
      result[key] = value;
      i = consumed;
    } else {
      result[key] = null;
    }
  }

  return [result, i];
}

function parseSequence(lines, start, indent) {
  const result = [];
  let i = start;

  while (i < lines.length && lines[i].indent === indent && lines[i].content.startsWith('- ')) {
    const rest = lines[i].content.slice(2).trim();
    const itemIndent = indent + 2;

    if (KEY_VALUE.test(rest)) {
      const sub = [{ indent: itemIndent, content: rest, line: lines[i].line }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) {
        sub.push(lines[j]);
        j++;
      }
      const [value] = parseMapping(sub, 0, itemIndent);
      result.push(value);
      i = j;
    } else {
      result.push(unquote(rest));
      i++;
    }
  }

  return [result, i];
}

function parseNode(lines, start, indent) {
  if (lines[start].content.startsWith('- ')) return parseSequence(lines, start, indent);
  return parseMapping(lines, start, indent);
}

export function parseYaml(source) {
  const lines = tokenize(source);
  if (lines.length === 0) return {};
  const [value] = parseNode(lines, 0, lines[0].indent);
  return value;
}
