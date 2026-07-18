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

// The tokenizer used to strip Unicode marks (Mn) along with punctuation, because
// \p{L} does not cover Thai vowel signs or tone marks. Every diacritic became a
// space, so words shattered mid-syllable: "แผนการจัดการเรียนรู้" tokenized to
// ["แผนการจ","ดการเร","ยนร"]. Matching then ran on accidental consonant-run
// collisions between mutilated fragments — nonzero, so it never failed loudly,
// but meaningless in the system's primary language.
test('tokenize keeps Thai vowels and tone marks intact', () => {
  const t = tokenize('แผนการจัดการเรียนรู้');
  const joined = t.join('');
  for (const mark of ['ั', 'ี', 'ู', '้']) {
    assert.ok(joined.includes(mark), `mark ${mark} must survive tokenization`);
  }
  assert.ok(
    !t.some((tok) => tok === 'ยนร' || tok === 'ดการเร'),
    'no mid-syllable fragments',
  );
});

// Guards the runtime, not just the code: Intl.Segmenter needs full ICU to
// segment Thai. On a small-icu build it silently falls back to treating a whole
// Thai run as one token — no crash, no error, just matching that quietly stops
// working. That is precisely the failure mode this fix exists to remove, so it
// gets an assertion rather than a comment.
test('Thai word segmentation is actually available in this runtime', () => {
  const t = tokenize('ออกแบบการจัดการเรียนรู้');
  assert.ok(
    t.length >= 3,
    `expected Thai to segment into words, got ${JSON.stringify(t)} — is this a full-ICU build?`,
  );
  assert.ok(t.includes('ออกแบบ'), 'expected a real word boundary at ออกแบบ');
});

// The regression that matters is not prettier tokens, it is recall: fragmenting
// depresses every score toward the minScore cutoff, so true matches get filtered
// out entirely. This exact input returned ZERO suggestions before the fix.
test('finds a real match that fragmentation used to miss entirely', () => {
  const matches = rankIndicators(
    'เกียรติบัตรอบรมพัฒนาตนเอง หลักสูตรการสอนเชิงรุก',
    [
      { id: 'dev', code: 'T-3.1', nameTh: 'พัฒนาตนเองอย่างเป็นระบบและต่อเนื่อง', indicatorKind: 'standard' },
      { id: 'design', code: 'T-1.2', nameTh: 'ออกแบบการจัดการเรียนรู้', indicatorKind: 'standard' },
      { id: 'info', code: 'T-2.1', nameTh: 'จัดทำข้อมูลสารสนเทศของผู้เรียนและรายวิชา', indicatorKind: 'standard' },
    ],
  );
  assert.ok(matches.length >= 1, 'must not return an empty suggestion list');
  assert.equal(matches[0].indicatorId, 'dev');
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
