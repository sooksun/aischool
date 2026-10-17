/**
 * Selecting the seeded rubric text for a scoring row.
 *
 * ADR-0003: indicator level descriptions are versioned seed data, not UI copy.
 * Each framework seeds IndicatorLevelDescription rows keyed by
 * (indicator, rank_level_code, rubric_level) — 792 of them across ว9 + ว10.
 *
 * Before CCR-013 the scoring page never fetched them (no `include=levels`) and
 * could not have used them anyway (the assignment did not carry the evaluatee's
 * rank), so every indicator was scored against the same four generic phrases.
 */
import type { components } from '../api/schema.generated';

type Indicator = components['schemas']['Indicator'];

/**
 * Expected-practice text for one (indicator, rank, rubric level), or null when
 * that row was not seeded — ครูผู้ช่วย (execute_learn) currently has no
 * transcribed anchors, and `levels` is undefined entirely unless the framework
 * was requested with include=levels. Callers fall back to the generic band name
 * rather than rendering an empty option.
 */
export function levelTextFor(
  indicator: Pick<Indicator, 'levels'>,
  rankCode: string,
  rubricLevel: number,
): string | null {
  if (!rankCode) return null;
  const match = indicator.levels?.find(
    (l) => l.rank_level_code === rankCode && l.rubric_level === rubricLevel,
  );
  return match?.expected_practice_th ?? null;
}

/** Whether this indicator has ANY seeded text for the rank — drives the
 * "ใช้เกณฑ์กลาง" disclosure, so an evaluator can tell the difference between
 * framework criteria and a generic fallback instead of assuming the former. */
export function hasLevelText(indicator: Pick<Indicator, 'levels'>, rankCode: string): boolean {
  if (!rankCode) return false;
  return Boolean(indicator.levels?.some((l) => l.rank_level_code === rankCode));
}
