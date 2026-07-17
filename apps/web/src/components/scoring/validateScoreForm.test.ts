import { describe, test, expect } from 'vitest';
import { validateScoreForm } from './validateScoreForm';

const IDS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
];

describe('validateScoreForm', () => {
  test('rejects incomplete set (SCORE-005 mirror)', () => {
    const r = validateScoreForm(IDS, [
      { indicator_id: IDS[0], rubric_level: 3 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.messageTh).toMatch(/ครบทุกข้อ|SCORE-005/);
  });

  test('rejects rubric outside 1..4', () => {
    const r = validateScoreForm(IDS, [
      { indicator_id: IDS[0], rubric_level: 3 },
      { indicator_id: IDS[1], rubric_level: 5 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.messageTh).toMatch(/1 ถึง 4/);
  });

  test('rejects null rubric', () => {
    const r = validateScoreForm(IDS, [
      { indicator_id: IDS[0], rubric_level: 3 },
      { indicator_id: IDS[1], rubric_level: null },
    ]);
    expect(r.ok).toBe(false);
  });

  test('accepts complete valid set', () => {
    const r = validateScoreForm(IDS, [
      { indicator_id: IDS[0], rubric_level: 1 },
      { indicator_id: IDS[1], rubric_level: 4, comment: 'ดี' },
    ]);
    expect(r.ok).toBe(true);
  });
});
