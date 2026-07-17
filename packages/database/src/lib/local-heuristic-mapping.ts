// On-prem local_heuristic mapping (ADR-0007). Token-overlap scoring only —
// never calls an external network. Pure functions + thin DB helpers live here
// so the API can run suggest synchronously without a worker round-trip.

/** Normalize Thai/English text into lowercase tokens (letters/digits only). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
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
