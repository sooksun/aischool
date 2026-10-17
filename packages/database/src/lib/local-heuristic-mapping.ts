// On-prem local_heuristic mapping (ADR-0007). Token-overlap scoring only —
// never calls an external network. Pure functions + thin DB helpers live here
// so the API can run suggest synchronously without a worker round-trip.

/**
 * Thai has no spaces between words, so splitting on whitespace cannot produce
 * words — ICU segmentation does that. Built once: constructing a Segmenter is
 * expensive relative to a tokenize() call, and rankIndicators calls tokenize per
 * indicator.
 *
 * Requires a full-ICU runtime (Node 18+ ships one by default). On a small-icu
 * build this degrades to "whole Thai run = one token" rather than throwing, so
 * local-heuristic.test.mjs asserts segmentation actually happens.
 */
const WORD_SEGMENTER = new Intl.Segmenter('th', { granularity: 'word' });

/**
 * Normalize Thai/English text into lowercase word tokens.
 *
 * `\p{M}` in the keep-set is load-bearing. Thai vowel signs and tone marks
 * (ั ิ ี ุ ู ่ ้ ็) are Unicode category Mn — NOT \p{L} and NOT \p{N} — so the
 * previous class stripped them as if they were punctuation, shattering every
 * word at each mark: "แผนการจัดการเรียนรู้" became ["แผนการจ","ดการเร","ยนร"].
 * Scoring then compared accidental consonant runs, which produced plausible
 * nonzero numbers while depressing real matches below minScore (2026-07-18
 * audit).
 */
export function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]+/gu, ' ');
  const tokens: string[] = [];
  for (const { segment, isWordLike } of WORD_SEGMENTER.segment(cleaned)) {
    if (!isWordLike) continue;
    const token = segment.trim();
    if (token.length >= 2) tokens.push(token);
  }
  return tokens;
}

export function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface IndicatorCandidate {
  id: string;
  code: string;
  nameTh: string;
  indicatorKind: string;
}

export interface HeuristicMatch {
  indicatorId: string;
  score: number;
  rationale: string;
}

/**
 * Rank indicators by token overlap against evidence title+description.
 * Excludes workload_gate (MAP-003). Returns top `max` with score >= minScore.
 */
export function rankIndicators(
  evidenceText: string,
  indicators: IndicatorCandidate[],
  opts: { max?: number; minScore?: number } = {},
): HeuristicMatch[] {
  const max = opts.max ?? 5;
  const minScore = opts.minScore ?? 0.08;
  const evidenceTokens = new Set(tokenize(evidenceText));
  if (evidenceTokens.size === 0) return [];

  const scored: HeuristicMatch[] = [];
  for (const ind of indicators) {
    if (ind.indicatorKind === 'workload_gate') continue;
    const indTokens = new Set(tokenize(`${ind.code} ${ind.nameTh}`));
    const score = jaccardScore(evidenceTokens, indTokens);
    if (score < minScore) continue;
    scored.push({
      indicatorId: ind.id,
      score,
      rationale: `local_heuristic score=${score.toFixed(3)} vs ${ind.code}`,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max);
}
