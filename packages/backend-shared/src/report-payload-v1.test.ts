import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceReportPayloadV1,
  isReportPayloadReady,
  parseReportPayloadV1,
  pendingReportPayloadV1,
  REPORT_PAYLOAD_SCHEMA_VERSION,
} from './report-payload-v1.ts';

test('pendingReportPayloadV1 sets schema_version and pending status', () => {
  const p = pendingReportPayloadV1('PA2_s');
  assert.equal(p.schema_version, REPORT_PAYLOAD_SCHEMA_VERSION);
  assert.equal(p.generation_status, 'pending');
  assert.equal(p.template_code, 'PA2_s');
  assert.equal(isReportPayloadReady(p), false);
});

test('parseReportPayloadV1 accepts a full ready payload', () => {
  const raw = {
    schema_version: 1,
    generation_status: 'ready',
    template_code: 'PA2_s',
    subject: {
      personnel_id: '22222222-2222-2222-2222-222222222222',
      full_name: 'ครูทดสอบ',
      position_role: 'teacher',
      rank_level_code: 'apply_adapt',
    },
    cycle: {
      id: '33333333-3333-3333-3333-333333333333',
      title: 'รอบ',
      fiscal_year: 2569,
      evaluation_kind: 'pa',
      framework_code: 'v9',
      framework_legal_ref: 'ว9',
    },
    round: null,
    confirmed_mappings: [],
    assignments: [],
    generated_at: '2026-07-18T00:00:00.000Z',
  };
  const p = parseReportPayloadV1(raw);
  assert.ok(isReportPayloadReady(p));
  if (isReportPayloadReady(p)) {
    assert.equal(p.subject.full_name, 'ครูทดสอบ');
    assert.equal(p.assignments.length, 0);
  }
});

test('parseReportPayloadV1 rejects unsupported schema_version', () => {
  assert.throws(
    () => parseReportPayloadV1({
      schema_version: 99,
      generation_status: 'pending',
      template_code: 'PA1_s',
    }),
    /unsupported schema_version/,
  );
});

test('coerceReportPayloadV1 falls back to pending when ready shape is incomplete', () => {
  const p = coerceReportPayloadV1({
    schema_version: 1,
    generation_status: 'ready',
    template_code: 'PA1_s',
  });
  assert.equal(p.generation_status, 'pending');
});
