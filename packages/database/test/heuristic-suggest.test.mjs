// P3 v0 heuristic floor: ranking, verbatim quotes, never `clear`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestFromSegments, validateQuote, quoteAround, normalizeText } from '../dist/lib/heuristic-suggest.js';

const INDICATORS = [
  { id: 'i-plan', code: 'T-1.2', nameTh: 'ออกแบบการจัดการเรียนรู้', indicatorKind: 'standard' },
  { id: 'i-media', code: 'T-1.4', nameTh: 'สร้างและหรือพัฒนาสื่อ นวัตกรรม เทคโนโลยี และแหล่งเรียนรู้', indicatorKind: 'standard' },
  { id: 'i-parents', code: 'T-2.4', nameTh: 'ประสานความร่วมมือกับผู้ปกครอง ภาคีเครือข่าย และหรือสถานประกอบการ', indicatorKind: 'standard' },
  { id: 'i-gate', code: 'T-W.1', nameTh: 'ออกแบบการจัดการเรียนรู้', indicatorKind: 'workload_gate' },
];

const PAGES = [
  { id: 's0', page: 1, text: 'แผนการจัดการเรียนรู้ที่ 3 วิชาภาษาไทย ชั้นประถมศึกษาปีที่ 4' },
  { id: 's1', page: 2, text: 'ครูออกแบบการจัดการเรียนรู้แบบ Active Learning โดยใช้เกมการอ่านเป็นสื่อ นักเรียนทำงานกลุ่ม' },
  { id: 's2', page: 3, text: 'ประชุมผู้ปกครองเพื่อสร้างความร่วมมือในการส่งเสริมการอ่านที่บ้าน' },
];

test('ranks the indicator whose words the item contains, with a verbatim quote on the right page', () => {
  const out = suggestFromSegments({ contextText: 'แผนการสอนอ่าน', segments: PAGES, indicators: INDICATORS });
  const plan = out.find((s) => s.indicatorId === 'i-plan');
  assert.ok(plan, 'T-1.2 suggested');
  assert.equal(plan.locators.length, 1);
  assert.equal(plan.locators[0].page, 2, 'the page that holds the most matched words');
  assert.ok(validateQuote(plan.locators[0].quote, PAGES[1].text));
  assert.ok(plan.locators[0].quote.length <= 200);
  assert.match(plan.rationaleTh, /T-1\.2/);
});

test('a workload-gate row is never suggested, and band is never clear', () => {
  const out = suggestFromSegments({ contextText: '', segments: PAGES, indicators: INDICATORS });
  assert.ok(!out.some((s) => s.indicatorId === 'i-gate'));
  assert.ok(out.every((s) => s.band !== 'clear'));
});

test('nothing in common: no suggestions rather than noise', () => {
  const out = suggestFromSegments({ contextText: 'รูปถ่ายวันกีฬาสี', segments: [], indicators: INDICATORS });
  assert.deepEqual(out, []);
});

test('a note-only item (no segments) still gets suggestions, without locators', () => {
  const out = suggestFromSegments({ contextText: 'บันทึก: ประชุมผู้ปกครองและภาคีเครือข่ายเรื่องความร่วมมือ', segments: [], indicators: INDICATORS });
  const p = out.find((s) => s.indicatorId === 'i-parents');
  assert.ok(p);
  assert.deepEqual(p.locators, []);
});

test('validateQuote refuses text that is not in the segment (the model-output gate)', () => {
  assert.equal(validateQuote('ครูออกแบบ  การจัดการเรียนรู้', 'ครูออกแบบ การจัดการเรียนรู้แบบ Active'), true, 'whitespace is normalised');
  assert.equal(validateQuote('นักเรียนได้คะแนนเต็ม', PAGES[1].text), false);
  assert.equal(validateQuote('', PAGES[1].text), false);
});

test('quoteAround returns a span that indexes the normalised text', () => {
  const q = quoteAround(PAGES[2].text, ['ผู้ปกครอง']);
  const t = normalizeText(PAGES[2].text);
  assert.equal(t.slice(q.span[0], q.span[1]), q.quote);
});
