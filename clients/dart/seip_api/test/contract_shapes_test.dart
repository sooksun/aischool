// SEIP-P0-004 — the payloads a Flutter client depends on most decode from
// realistic JSON into the generated types. Runs against whatever spec
// swagger_parser.yaml points at (the 4.0.0 draft during P0).
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:seip_api/seip_api.dart';
import 'package:test/test.dart';

const _ev = {
  'id': '0192d3a0-0000-7000-8000-000000000001',
  'owner_person_id': '0192d3a0-0000-7000-8000-000000000002',
  'controller_area_id': '0192d3a0-0000-7000-8000-000000000003',
  'origin_school_id': '0192d3a0-0000-7000-8000-000000000004',
  'kind': 'file',
  'category_id': '0192d3a0-0000-7000-8000-000000000005',
  'title': 'แผนการจัดการเรียนรู้ ภาคเรียนที่ 1',
  'status': 'active',
  'version': 3,
  'created_at': '2026-10-12T08:00:00Z',
  'updated_at': '2026-10-12T09:00:00Z',
  'performed_from': '2026-05-16',
  'performed_to': '2026-09-30',
  'academic_year_be': 2569,
  'semester': 1,
  'contains_learners': 'no',
  'client_uuid': '0192d3a0-0000-7000-8000-0000000000aa',
};

void main() {
  test('sync batch: an upsert carries the typed row, a delete is a tombstone', () {
    final batch = SyncChanges.fromJson(jsonDecode(jsonEncode({
      'next_cursor': 'c2',
      'has_more': false,
      'changes': [
        {'entity': 'evidence', 'op': 'upsert', 'id': _ev['id'], 'version': 3,
         'updated_at': '2026-10-12T09:00:00Z', 'evidence': _ev},
        {'entity': 'mapping', 'op': 'delete', 'id': '0192d3a0-0000-7000-8000-0000000000bb',
         'updated_at': '2026-10-12T09:01:00Z'},
      ],
    })) as Map<String, Object?>);
    expect(batch.changes, hasLength(2));
    final up = batch.changes.first;
    expect(up.entity, SyncEntity.evidence);
    expect(up.evidence!.title, startsWith('แผนการ'));
    expect(up.evidence!.semester, isNotNull);
    expect(up.mapping, isNull);
    final del = batch.changes.last;
    expect(del.op, SyncChangeOp.delete);
    expect([del.evidence, del.mapping, del.suggestion], everyElement(isNull));
  });

  test('suggestion: locators and owner-only fields decode; null owner fields are allowed', () {
    final s = Suggestion.fromJson({
      'id': '0192d3a0-0000-7000-8000-0000000000c1',
      'evidence_id': _ev['id'],
      'indicator_id': '0192d3a0-0000-7000-8000-0000000000c2',
      'indicator_code': 'T-1.1',
      'framework_version_id': '0192d3a0-0000-7000-8000-0000000000c3',
      'support': 'supports',
      'band': 'clear',
      'batch_acceptable': true,
      'locators': [
        {'segment_id': '0192d3a0-0000-7000-8000-0000000000c4', 'kind': 'page', 'page': 3,
         'quote': 'จัดกิจกรรมการเรียนรู้แบบ Active Learning', 'match_span': [10, 48]},
        {'segment_id': '0192d3a0-0000-7000-8000-0000000000c5', 'kind': 'time',
         't_start_ms': 61000, 't_end_ms': 74000},
      ],
      'provisional': false,
      'calibrated_p': null,
      'rationale_th': null,
      'status': 'open',
      'created_at': '2026-10-12T09:05:00Z',
    });
    expect(s.band, SuggestionBand.clear);
    expect(s.locators.first.page, 3);
    expect(s.locators.last.tStartMs, 61000);
    expect(s.calibratedP, isNull);
  });

  test('upload session: multipart resume reads parts_received', () {
    final u = UploadSession.fromJson({
      'id': '0192d3a0-0000-7000-8000-0000000000d1',
      'evidence_id': _ev['id'],
      'file_id': '0192d3a0-0000-7000-8000-0000000000d2',
      'protocol': 's3_multipart',
      'byte_size': 900 * 1024 * 1024,
      'part_size': 16 * 1024 * 1024,
      'part_count': 57,
      'status': 'open',
      'expires_at': '2026-10-19T09:00:00Z',
      'single_put': null,
      'parts_received': [1, 2, 3, 5],
    });
    expect(u.protocol, UploadProtocol.s3Multipart);
    final firstMissing = List.generate(u.partCount, (i) => i + 1)
        .firstWhere((n) => !u.partsReceived.contains(n));
    expect(firstMissing, 4);
  });

  test('the root client exposes every tag group', () {
    final api = SeipApi(Dio(), baseUrl: 'https://example.invalid/api/v1');
    expect(api.uploads, isNotNull);
    expect(api.analysis, isNotNull);
    expect(api.sync, isNotNull);
    expect(api.exports, isNotNull);
  });
}
