// P3: the owner's sent evidence and its suggestions in the app — accept turns
// one into a mapping, reject sends a reason; provisional suggestions say so.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:seip_api/seip_api.dart';
import 'package:seip_mobile/src/suggestions.dart';

class _Api implements HttpClientAdapter {
  final open = <String>{'s1', 's2'};
  final calls = <String>[];
  Map<String, Object?>? rejectBody;

  ResponseBody _json(int status, Object body) =>
      ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: ['application/json']});

  Map<String, Object?> _suggestion(String id, String code) => {
        'id': id, 'evidence_id': 'e1', 'indicator_id': 'i-$id', 'indicator_code': code, 'framework_version_id': 'fw',
        'band': 'likely', 'locators': [
          {'segment_id': 'g1', 'kind': 'page', 'page': 2, 'quote': 'ครูออกแบบการจัดการเรียนรู้'},
        ],
        'provisional': true, 'status': 'open', 'created_at': '2026-10-14T00:00:00Z', 'rationale_th': 'พบคำที่ตรงกับตัวชี้วัด $code',
      };

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    calls.add('${o.method} ${o.path}');
    const now = '2026-10-14T00:00:00Z';
    if (o.method == 'GET' && o.path == '/evidence') {
      expect(o.queryParameters['owner_person_id'], 'p1');
      return _json(200, {
        'items': [
          {'id': 'e1', 'owner_person_id': 'p1', 'controller_area_id': null, 'origin_school_id': 's', 'kind': 'file', 'category_id': 'c',
            'title': 'แผนการสอนอ่าน', 'status': 'active', 'version': 1, 'created_at': now, 'updated_at': now},
        ],
        'meta': {'page': 1, 'page_size': 50, 'total': 1},
      });
    }
    if (o.method == 'GET' && o.path == '/evidence/e1/suggestions') {
      return _json(200, {
        'items': [if (open.contains('s1')) _suggestion('s1', 'T-1.2'), if (open.contains('s2')) _suggestion('s2', 'T-2.4')],
        'analysis': {'id': 'a1', 'evidence_id': 'e1', 'status': 'degraded', 'provisional': true, 'created_at': now},
      });
    }
    if (o.method == 'POST' && o.path == '/suggestions/s1/accept') {
      expect(o.headers['Idempotency-Key'], isNotNull);
      open.remove('s1');
      return _json(201, {
        'id': 'm1', 'evidence_id': 'e1', 'indicator_id': 'i-s1', 'framework_version_id': 'fw', 'mapping_source': 'ai_accepted',
        'status': 'owner_confirmed', 'owner_confirmed_by_user_id': 'u', 'owner_confirmed_at': now, 'version': 1, 'ai_suggestion_id': 's1',
      });
    }
    if (o.method == 'POST' && o.path == '/suggestions/s2/reject') {
      rejectBody = (o.data is Map ? o.data as Map : jsonDecode(o.data as String) as Map).cast();
      open.remove('s2');
      return _json(200, {..._suggestion('s2', 'T-2.4'), 'status': 'rejected'});
    }
    return _json(404, {'code': 'RES-001', 'message': o.path});
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  testWidgets('owner opens a sent item, accepts one suggestion and rejects another with a reason', (tester) async {
    final fake = _Api();
    final api = SeipApi(Dio()..httpClientAdapter = fake, baseUrl: 'https://api.test/api/v1');
    await tester.pumpWidget(MaterialApp(home: MyEvidenceScreen(api: api, personId: 'p1')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('evidence-e1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('provisionalNote')), findsOneWidget);
    expect(find.text('T-1.2 · น่าจะใช่'), findsOneWidget);
    expect(find.text('หน้า 2: “ครูออกแบบการจัดการเรียนรู้”'), findsNWidgets(2));

    await tester.tap(find.byKey(const Key('accept-s1')));
    await tester.pumpAndSettle();
    expect(fake.calls, contains('POST /suggestions/s1/accept'));
    expect(find.text('T-1.2 · น่าจะใช่'), findsNothing);
    expect(find.textContaining('รอผู้บริหารรับรอง'), findsOneWidget);

    await tester.tap(find.byKey(const Key('reject-s2')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('reason-wrongIndicator')));
    await tester.pumpAndSettle();
    expect(fake.rejectBody?['reason_code'], 'wrong_indicator');
    expect(find.byKey(const Key('noSuggestions')), findsOneWidget);
  });
}
