// P3 v0 (ADR-0010): suggestions on the local_heuristic floor, used until the
// in-country GPU tier exists and whenever it is unavailable (analysis status
// `degraded`). Pure functions — no network, no model. Every locator points at
// a stored segment and its quote is verbatim from that segment's text; the same
// validateQuote check will gate model output later (plan §3 step 4).
import { tokenize, type IndicatorCandidate } from './local-heuristic-mapping.js';

export interface SegmentText {
  id: string;
  page: number | null;
  text: string;
}

export interface SuggestedLocator {
  segment_id: string;
  kind: 'page';
  page: number | null;
  quote: string;
  match_span: [number, number];
}

export interface HeuristicSuggestion {
  indicatorId: string;
  score: number;
  band: 'likely' | 'possible';
  locators: SuggestedLocator[];
  rationaleTh: string;
  matched: string[];
}

export const HEURISTIC_MODEL_LABEL = 'SEIP local_heuristic';
export const HEURISTIC_PROMPT_VERSION = 'heuristic-v1';
const QUOTE_MAX = 200;

/** NFC + collapsed whitespace — how Thai text is compared everywhere here. */
export function normalizeText(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** A quote is valid only if it occurs verbatim (after normalisation) in its segment. */
export function validateQuote(quote: string, segmentText: string): boolean {
  const q = normalizeText(quote);
  return q.length > 0 && normalizeText(segmentText).includes(q);
}

/**
 * The window of segment text (≤ QUOTE_MAX chars) around the first matched
 * word, cut at whitespace where possible. The returned span indexes the
 * normalised text.
 */
export function quoteAround(text: string, words: string[]): { quote: string; span: [number, number] } | null {
  const t = normalizeText(text);
  const lower = t.toLowerCase();
  let at = -1;
  let len = 0;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) { at = i; len = w.length; }
  }
  if (at < 0) return null;
  let start = Math.max(0, at - 60);
  let end = Math.min(t.length, Math.max(at + len, start + QUOTE_MAX));
  if (end - start > QUOTE_MAX) end = start + QUOTE_MAX;
  const sp = t.lastIndexOf(' ', at);
  if (sp >= start) start = sp + 1;
  const ep = t.indexOf(' ', Math.max(at + len, end - 20));
  if (ep > 0 && ep <= end) end = ep;
  const quote = t.slice(start, end).trim();
  const qs = t.indexOf(quote, start);
  return { quote, span: [qs, qs + quote.length] };
}

/**
 * Rank the framework's indicators against the item. The score is the share of
 * an indicator's words found in the item (title, description, note, and the
 * text of every segment). It is not a probability, so band is never `clear`
 * and calibrated_p stays null: nothing here may be batch-accepted (AI-004).
 */
export function suggestFromSegments(
  input: { contextText: string; segments: SegmentText[]; indicators: IndicatorCandidate[] },
  opts: { max?: number; minScore?: number } = {},
): HeuristicSuggestion[] {
  const max = opts.max ?? 5;
  const minScore = opts.minScore ?? 0.34;
  const segTokens = input.segments.map((s) => ({ seg: s, tokens: new Set(tokenize(s.text)) }));
  const all = new Set([...tokenize(input.contextText), ...segTokens.flatMap((s) => [...s.tokens])]);
  if (all.size === 0) return [];

  const out: HeuristicSuggestion[] = [];
  for (const ind of input.indicators) {
    if (ind.indicatorKind === 'workload_gate') continue;
    const words = [...new Set(tokenize(ind.nameTh))];
    if (words.length === 0) continue;
    const matched = words.filter((w) => all.has(w));
    const score = matched.length / words.length;
    if (score < minScore) continue;

    // The segment holding most of the matched words carries the locator.
    let best: { seg: SegmentText; hits: string[] } | null = null;
    for (const { seg, tokens } of segTokens) {
      const hits = matched.filter((w) => tokens.has(w));
      if (hits.length > 0 && (!best || hits.length > best.hits.length)) best = { seg, hits };
    }
    const locators: SuggestedLocator[] = [];
    if (best) {
      const q = quoteAround(best.seg.text, best.hits);
      if (q && validateQuote(q.quote, best.seg.text)) {
        locators.push({ segment_id: best.seg.id, kind: 'page', page: best.seg.page, quote: q.quote, match_span: q.span });
      }
    }
    out.push({
      indicatorId: ind.id,
      score,
      band: score >= 0.6 ? 'likely' : 'possible',
      locators,
      matched,
      rationaleTh: `พบคำที่ตรงกับตัวชี้วัด ${ind.code}: ${matched.slice(0, 8).join(', ')} (ระบบสำรองแบบจับคำ ยังไม่ใช่ AI — โปรดตรวจเอง)`,
    });
  }
  out.sort((a, b) => b.score - a.score || b.locators.length - a.locators.length);
  return out.slice(0, max);
}
