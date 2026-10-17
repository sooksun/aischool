// FR-023a: rules-based PII masking (national id, phone, email).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactPii } from '../dist/lib/pii-redact.js';

const ID_CASES = ['1101700203451', '1-1017-00203-45-1', '1 1017 00203 45 1', '๑๑๐๑๗๐๐๒๐๓๔๕๑'];
const PHONE_CASES = ['0812345678', '081-234-5678', '081 234 5678', '02-123-4567', '021234567', '+66 81 234 5678', '+66812345678', '๐๘๑๒๓๔๕๖๗๘'];

test('national ids are masked in every common shape, Thai digits included', () => {
  for (const id of ID_CASES) {
    const r = redactPii(`เลขบัตร ${id} ของนักเรียน`);
    assert.equal(r.text, 'เลขบัตร [เลขบัตรประชาชน] ของนักเรียน', id);
    assert.equal(r.counts.national_id, 1);
    assert.equal(r.counts.phone, 0, `${id} must not also count as a phone`);
  }
});

test('phone numbers are masked: mobile, landline, +66', () => {
  for (const p of PHONE_CASES) {
    const r = redactPii(`ติดต่อผู้ปกครอง ${p} ได้`);
    assert.equal(r.text, 'ติดต่อผู้ปกครอง [เบอร์โทร] ได้', p);
  }
});

test('emails are masked', () => {
  assert.equal(redactPii('ส่งงานที่ kru.somsri@school.ac.th ครับ').text, 'ส่งงานที่ [อีเมล] ครับ');
});

test('ordinary numbers stay: years, scores, class sizes, page numbers', () => {
  const t = 'ปีการศึกษา 2568 นักเรียน 35 คน คะแนนเฉลี่ย 78.50 หน้า 12 ชั้น ป.4/2 เวลา 08.30-09.20 น.';
  const r = redactPii(t);
  assert.equal(r.text, t);
  assert.deepEqual(r.counts, { national_id: 0, phone: 0, email: 0 });
});

test('a seeded corpus: every planted id and phone is caught (recall 1.0 on this set)', () => {
  let planted = 0;
  let caught = 0;
  for (let i = 0; i < 50; i++) {
    const id = ID_CASES[i % ID_CASES.length];
    const ph = PHONE_CASES[i % PHONE_CASES.length];
    const r = redactPii(`รายงานที่ ${i + 1} นักเรียนเลขประจำตัว ${id} โทร ${ph} ปี 2568`);
    planted += 2;
    caught += r.counts.national_id + r.counts.phone;
  }
  assert.equal(caught, planted);
});
