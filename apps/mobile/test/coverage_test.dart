// FR-053: the home-screen coverage card counts indicators without evidence.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:seip_api/seip_api.dart';
import 'package:seip_mobile/src/coverage.dart';

class _Api implements HttpClientAdapter {
  final queries = <String, Map<String, dynamic>>{};
  ResponseBody _json(Object body) =>
      ResponseBody.fromString(jsonEncode(body), 200, headers: {Headers.contentTypeHeader: ['application/json']});
  Map<String, Object?> _row(String code, int validated, int confirmed, int open) => {
        'indicator_id': 'i-$code', 'indicator_code': code, 'owner_confirmed': confirmed, 'validated': validated, 'returned': 0, 'open_suggestions': open,
      };
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    queries[o.path] = o.queryParameters;
    if (o.path == '/frameworks') {
      return _json([
        {'id': 'fw1', 'code': 'v9', 'role_family': 'teacher', 'legal_ref': 'ว9', 'revision_year': 2564, 'status': 'active', 'effective_from': '2021-10-01'},
      ]);
    }
    if (o.path == '/coverage') {
      return _json({
        'subject_type': 'person', 'subject_id': 'p1', 'framework_version_id': 'fw1',
        'indicators': [_row('T-1.1', 1, 0, 0), _row('T-1.2', 0, 2, 1), _row('T-1.3', 0, 0, 2)],
      });
    }
    throw DioException(requestOptions: o, type: DioExceptionType.connectionError);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  testWidgets('the card shows gaps, waiting mappings and open suggestions', (tester) async {
    final fake = _Api();
    final api = SeipApi(Dio()..httpClientAdapter = fake, baseUrl: 'https://api.test/api/v1');
    const me = CurrentUser(id: 'u', email: 'k@seip.local', displayName: 'ครู', memberships: [], personId: 'p1');
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: SizedBox())));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: CoverageCard(api: api, me: me))));
    await tester.pumpAndSettle();
    expect(find.text('ยังไม่มีหลักฐานใน 1 จาก 3 ตัวชี้วัด'), findsOneWidget);
    expect(find.text('รอผู้บริหารรับรอง 2 รายการ'), findsOneWidget);
    expect(find.text('คำแนะนำรอคุณตรวจ 3 รายการ'), findsOneWidget);
    expect('${fake.queries['/frameworks']?['role_family']}', 'teacher');
    expect(fake.queries['/coverage']?['subject_id'], 'p1');
  });

  testWidgets('offline: the card stays hidden rather than showing an error', (tester) async {
    final api = SeipApi(Dio()..httpClientAdapter = _Api(), baseUrl: 'https://api.test/api/v1');
    const me = CurrentUser(id: 'u', email: 'k@seip.local', displayName: 'ครู', memberships: []);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: CoverageCard(api: api, me: me))));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('coverageCard')), findsNothing, reason: 'no person → nothing to show');
  });
}
