// Client-side mirror of SCORE-003 / SCORE-005 checks — fail fast before API call.
// Server remains source of truth (apps/api scoring routes).

export interface ScoreRowInput {
  indicator_id: string;
  rubric_level: number | null;
  comment?: string | null;
}

export interface ScoreFormValidation {
  ok: boolean;
  messageTh?: string;
}

/** Returns error if the set is incomplete or any level is out of 1..4. */
export function validateScoreForm(
  scorableIndicatorIds: string[],
  rows: ScoreRowInput[],
): ScoreFormValidation {
  if (scorableIndicatorIds.length === 0) {
    return { ok: false, messageTh: 'ไม่พบตัวชี้วัดที่ต้องให้คะแนนในกรอบนี้' };
  }
  const byId = new Map(rows.map((r) => [r.indicator_id, r]));
  for (const id of scorableIndicatorIds) {
    const row = byId.get(id);
    if (!row || row.rubric_level == null) {
      return { ok: false, messageTh: 'ต้องให้คะแนนตัวชี้วัดครบทุกข้อ (SCORE-005)' };
    }
    if (!Number.isInteger(row.rubric_level) || row.rubric_level < 1 || row.rubric_level > 4) {
      return { ok: false, messageTh: 'ระดับคะแนนต้องเป็น 1 ถึง 4 เท่านั้น' };
    }
  }
  if (rows.length !== scorableIndicatorIds.length) {
    return { ok: false, messageTh: 'จำนวนตัวชี้วัดที่ให้คะแนนไม่ตรงกับกรอบการประเมิน' };
  }
  return { ok: true };
}

export const RUBRIC_OPTIONS: { value: number; labelTh: string }[] = [
  { value: 1, labelTh: '1 — ต่ำกว่าที่คาดหวังมาก' },
  { value: 2, labelTh: '2 — ต่ำกว่าที่คาดหวัง' },
  { value: 3, labelTh: '3 — ตามที่คาดหวัง' },
  { value: 4, labelTh: '4 — สูงกว่าที่คาดหวัง' },
];
