// PA report PDF generation (structure-faithful form, SEIP layout).
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPaReportPdf, isPdfBuffer } from '../dist/lib/pa-report-pdf.js';

test('buildPaReportPdf returns a valid PDF for ready PA2_s payload', async () => {
  const buf = await buildPaReportPdf({
    id: '11111111-1111-1111-1111-111111111111',
    templateCode: 'PA2_s',
    status: 'pending_approval',
    generatedAt: new Date(),
    payload: {
      schema_version: 1,
      generation_status: 'ready',
      template_code: 'PA2_s',
      subject: {
        personnel_id: '22222222-2222-2222-2222-222222222222',
        full_name: 'ครูทดสอบ ระบบ',
        position_role: 'teacher',
        rank_level_code: 'apply_adapt',
      },
      cycle: {
        id: '33333333-3333-3333-3333-333333333333',
        title: 'รอบทดสอบ PDF',
        fiscal_year: 2569,
        evaluation_kind: 'pa',
        framework_code: 'v9-2564-teacher',
        framework_legal_ref: 'ว 9/2564',
      },
      round: { id: '44444444-4444-4444-4444-444444444444', round_number: 1, purpose: 'salary', status: 'closed' },
      confirmed_mappings: [
        {
          mapping_id: '88888888-8888-8888-8888-888888888888',
          evidence_id: '77777777-7777-7777-7777-777777777777',
          evidence_title: 'แผนการสอน',
          indicator_id: '99999999-9999-9999-9999-999999999999',
          indicator_code: 'T-1.1',
          indicator_name_th: 'การจัดการเรียนรู้',
          confirmed_at: new Date().toISOString(),
        },
      ],
      assignments: [
        {
          assignment_id: '55555555-5555-5555-5555-555555555555',
          round_id: '44444444-4444-4444-4444-444444444444',
          round_number: 1,
          status: 'completed',
          committee_size: 3,
          evaluator_results: [
            {
              evaluator_user_id: '66666666-6666-6666-6666-666666666666',
              part1_percent: 80,
              part2_percent: 75,
              total_percent: 78,
              passed_individual_threshold: true,
              computed_at: new Date().toISOString(),
            },
          ],
        },
      ],
      generated_at: new Date().toISOString(),
    },
    sectionRefs: [
      { sectionKey: 'indicator:T-1.1', evidenceId: '77777777-7777-7777-7777-777777777777', mappingId: null, sortOrder: 1 },
    ],
  });
  assert.ok(isPdfBuffer(buf), 'must start with %PDF-');
  assert.ok(buf.length > 500, 'pdf should have substantive size');
});

test('buildPaReportPdf rejects draft/pending generation', async () => {
  await assert.rejects(
    () => buildPaReportPdf({
      id: '11111111-1111-1111-1111-111111111111',
      templateCode: 'PA1_s',
      status: 'draft',
      generatedAt: new Date(),
      payload: { generation_status: 'pending' },
      sectionRefs: [],
    }),
    (e) => e instanceof Error && e.message === 'REPORT_NOT_READY',
  );
});
