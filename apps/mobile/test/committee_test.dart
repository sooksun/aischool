// FR-065: the read-only committee view — open rounds' assignments, then the
// evaluatee's confirmed evidence grouped by indicator in framework order, with
// the provenance label (FR-047) and no way to validate, return or comment.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:seip_api/seip_api.dart';
import 'package:seip_mobile/src/committee.dart';

class _Api implements HttpClientAdapter {
  _Api({this.closed = false});
  final bool closed;
  final paths = <String>[];
  ResponseBody _json(Object body, [int status = 200]) =>
      ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: ['application/json']});

  Map<String, Object?> _item(String evidenceId, String indicatorId, String title, String source, String status) => {
        'indicator_id': indicatorId,
        'mapping': {
          'id': 'm-$evidenceId-$indicatorId', 'evidence_id': evidenceId, 'indicator_id': indicatorId, 'mapping_source': source,
          'status': status, 'framework_version_id': 'fw1', 'owner_confirmed_by_user_id': 'u1', 'owner_confirmed_at': '2026-11-01T00:00:00Z', 'version': 1,
        },
        'evidence': {
          'id': evidenceId, 'category_id': 'c1', 'title': title, 'status': 'active', 'created_at': '2026-11-01T00:00:00Z',
          'owner_person_id': 'p1', 'controller_area_id': null, 'origin_school_id': 's1', 'kind': 'note', 'version': 1, 'updated_at': '2026-11-01T00:00:00Z',
        },
        'files': <Object>[],
      };

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    paths.add(o.path);
    switch (o.path) {
      case '/personnel':
        return _json([
          {'id': 'pp1', 'full_name': 'ครูสมศรี', 'position_role': 'teacher', 'rank_level_code': 'kru', 'status': 'active'},
        ]);
      case '/cycles':
        return _json([
          {'id': 'c1', 'title': 'PA 2570', 'fiscal_year': 2570, 'evaluation_kind': 'pa', 'framework_code': 'v9', 'framework_legal_ref': 'ว9'},
        ]);
      case '/cycles/c1':
        return _json({
          'id': 'c1', 'school_id': 's1', 'framework_version_id': 'fw1', 'fiscal_year': 2570, 'evaluation_kind': 'pa', 'title': 'PA 2570',
          'status': 'open', 'starts_on': '2026-10-01', 'ends_on': '2027-09-30', 'framework_code': 'v9', 'framework_legal_ref': 'ว9',
          'rounds': [
            {'id': 'r1', 'round_number': 1, 'purpose': 'x', 'status': 'open'},
            {'id': 'r0', 'round_number': 0, 'purpose': 'old', 'status': 'closed'},
          ],
        });
      case '/rounds/r1/assignments':
        return _json({
          'items': [
            {'id': 'a1', 'round_id': 'r1', 'evaluatee_personnel_id': 'pp1', 'status': 'in_progress', 'committee': <Object>[]},
          ],
          'meta': {'page': 1, 'page_size': 100, 'total': 1},
        });
      case '/assignments/a1/evidence':
        if (closed) return _json({'code': 'PERM-003', 'message': 'closed'}, 403);
        return _json({
          'items': [
            _item('e2', 'i2', 'ภาพกิจกรรม', 'manual', 'owner_confirmed'),
            _item('e1', 'i1', 'แผนการสอน', 'ai_accepted', 'validated'),
          ],
          'next_cursor': null,
        });
      case '/frameworks/fw1':
        Map<String, Object?> ind(String id, String code, int n) =>
            {'id': id, 'code': code, 'name_th': 'ชื่อ $code', 'sort_order': n, 'is_scored': true, 'indicator_kind': 'standard'};
        return _json({
          'id': 'fw1', 'code': 'v9', 'role_family': 'teacher', 'legal_ref': 'ว9', 'revision_year': 2564, 'status': 'active', 'score_weights': <Object>[],
          'domains': [
            {'id': 'd1', 'code': 'D1', 'name_th': 'ด้าน 1', 'sort_order': 1, 'part': 'standards', 'indicators': [ind('i1', 'T-1.1', 1), ind('i2', 'T-1.2', 2)]},
          ],
        });
    }
    throw DioException(requestOptions: o, type: DioExceptionType.connectionError);
  }

  @override
  void close({bool force = false}) {}
}

SeipApi _api(_Api fake) => SeipApi(Dio()..httpClientAdapter = fake, baseUrl: 'https://api.test/api/v1');

void main() {
  test('the committee view is offered to evaluators and directors only', () {
    CurrentUser me(Role r) => CurrentUser(id: 'u', email: 'x@seip.local', displayName: 'x', memberships: [
          Memberships(role: r, membershipScope: MembershipScope.school, schoolId: 's1'),
        ]);
    expect(canSeeCommitteeView(me(Role.evaluator)), isTrue);
    expect(canSeeCommitteeView(me(Role.director)), isTrue);
    expect(canSeeCommitteeView(me(Role.teacher)), isFalse);
    expect(canSeeCommitteeView(me(Role.dpo)), isFalse);
  });

  testWidgets('open rounds only; the evaluatee by name; evidence grouped in framework order, read-only', (tester) async {
    final fake = _Api();
    await tester.pumpWidget(MaterialApp(home: CommitteeScreen(api: _api(fake))));
    await tester.pumpAndSettle();
    expect(find.text('ครูสมศรี'), findsOneWidget);
    expect(find.text('PA 2570 · รอบที่ 1'), findsOneWidget);
    expect(fake.paths, isNot(contains('/rounds/r0/assignments')), reason: 'a closed round is not listed');

    await tester.tap(find.byKey(const Key('assignment-a1')));
    await tester.pumpAndSettle();
    expect(find.text('หลักฐาน · ครูสมศรี'), findsOneWidget);
    final first = tester.getTopLeft(find.byKey(const Key('indicator-T-1.1'))).dy;
    final second = tester.getTopLeft(find.byKey(const Key('indicator-T-1.2'))).dy;
    expect(first, lessThan(second), reason: 'framework order, not response order');
    expect(find.text('AI เสนอ · ยืนยันโดยเจ้าของ · รับรองแล้ว · ไฟล์ 0'), findsOneWidget);
    expect(find.text('เจ้าของเพิ่มเอง · รอรับรอง · ไฟล์ 0'), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing, reason: 'no validate / return / comment here');
    expect(find.byType(TextField), findsNothing);
  });

  testWidgets('a closed round (PERM-003) says access has ended', (tester) async {
    await tester.pumpWidget(MaterialApp(home: CommitteeEvidenceScreen(api: _api(_Api(closed: true)), assignmentId: 'a1', evaluateeName: 'ครูสมศรี')));
    await tester.pumpAndSettle();
    expect(find.text('สิทธิ์ดูหลักฐานของการประเมินนี้สิ้นสุดแล้ว'), findsOneWidget);
  });
}
