import { describe, expect, test } from 'vitest';
import { levelTextFor, hasLevelText } from './rubricLevels';

const indicator = {
  levels: [
    { rank_level_code: 'apply_adapt', rubric_level: 1 as const, expected_practice_th: 'A1' },
    { rank_level_code: 'apply_adapt', rubric_level: 2 as const, expected_practice_th: 'A2' },
    { rank_level_code: 'apply_adapt', rubric_level: 3 as const, expected_practice_th: 'A3' },
    { rank_level_code: 'apply_adapt', rubric_level: 4 as const, expected_practice_th: 'A4' },
    { rank_level_code: 'initiate_develop', rubric_level: 3 as const, expected_practice_th: 'B3' },
  ],
};

describe('levelTextFor', () => {
  test('picks the row for the given rank AND level', () => {
    expect(levelTextFor(indicator, 'apply_adapt', 3)).toBe('A3');
  });

  // The rank is what makes this data meaningful — the same indicator expects
  // different practice from a ครูชำนาญการ than from a ครูผู้ช่วย. Ignoring it
  // would show every evaluatee the same text and quietly restore the bug.
  test('does not leak another rank’s text', () => {
    expect(levelTextFor(indicator, 'initiate_develop', 3)).toBe('B3');
    expect(levelTextFor(indicator, 'initiate_develop', 1)).toBeNull();
  });

  test('returns null for an unseeded rank, so the caller can fall back', () => {
    expect(levelTextFor(indicator, 'execute_learn', 2)).toBeNull();
  });

  // `levels` is absent unless the framework was fetched with include=levels.
  // Forgetting that param is the original bug, so it must degrade to the generic
  // label rather than throwing or rendering blank options.
  test('survives a framework fetched without include=levels', () => {
    expect(levelTextFor({ levels: undefined }, 'apply_adapt', 1)).toBeNull();
    expect(hasLevelText({ levels: undefined }, 'apply_adapt')).toBe(false);
  });

  test('an empty rank code never matches', () => {
    expect(levelTextFor(indicator, '', 3)).toBeNull();
    expect(hasLevelText(indicator, '')).toBe(false);
  });
});

describe('hasLevelText', () => {
  test('true when the rank has any seeded row, false otherwise', () => {
    expect(hasLevelText(indicator, 'apply_adapt')).toBe(true);
    expect(hasLevelText(indicator, 'initiate_develop')).toBe(true);
    expect(hasLevelText(indicator, 'execute_learn')).toBe(false);
  });
});
