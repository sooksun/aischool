// Unit tests for pure local_heuristic helpers (ADR-0007).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, jaccardScore, rankIndicators } from '../dist/lib/local-heuristic-mapping.js';

test('tokenize splits mixed Thai/English', () => {
  const t = tokenize('การจัดการเรียนรู้ Active Learning');
  assert.ok(t.includes('active'));
  assert.ok(t.includes('learning'));
  assert.ok(t.length >= 2);
});

test('jaccard identical sets is 1', () => {
  const a = new Set(['a', 'b']);
  assert.equal(jaccardScore(a, a), 1);
});

test('rankIndicators prefers overlapping names and skips workload_gate', () => {
  const matches = rankIndicators(
    'จัดการเรียนรู้ Active Learning แผนการสอน',
    [
      { id: '1', code: 'T-1.1', nameTh: 'การจัดการเรียนรู้', indicatorKind: 'standard' },
      { id: '2', code: 'T-W', nameTh: 'ภาระงาน', indicatorKind: 'workload_gate' },
      { id: '3', code: 'T-9.9', nameTh: 'อื่น ๆ ที่ไม่เกี่ยวข้อง', indicatorKind: 'standard' },
    ],
    { max: 3, minScore: 0.01 },
  );
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].indicatorId, '1');
  assert.ok(!matches.some((m) => m.indicatorId === '2'));
});
