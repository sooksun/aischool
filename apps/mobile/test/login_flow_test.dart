// The skeleton's one real flow — sign in, then load the caller — runs through
// the generated client against a fake HTTP adapter.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:seip_mobile/main.dart';
import 'package:seip_mobile/src/api.dart';

class _FakeApi implements HttpClientAdapter {
  _FakeApi({required this.acceptPassword});
  final String acceptPassword;
  final seen = <String>[];

  ResponseBody _json(int status, Object body) => ResponseBody.fromString(
        jsonEncode(body),
        status,
        headers: {Headers.contentTypeHeader: ['application/json']},
      );

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    seen.add('${o.method} ${o.path} ${o.headers['Authorization'] ?? ''}'.trim());
    if (o.path.endsWith('/auth/login')) {
      final req = o.data is String ? jsonDecode(o.data as String) : o.data;
      if (req['password'] != acceptPassword) {
        return _json(401, {'code': 'AUTH-001', 'message': 'invalid credentials'});
      }
      return _json(200, {'access_token': 'tok-1', 'refresh_token': 'ref-1', 'expires_in': 900});
    }
    if (o.path.endsWith('/auth/me')) {
      return _json(200, {
        'id': '0192d3a0-0000-7000-8000-000000000001',
        'email': 'kru@seip.local',
        'display_name': 'ครูสมศรี ใจดี',
        'memberships': [
          {'role': 'teacher', 'membership_scope': 'school', 'school_id': '0192d3a0-0000-7000-8000-000000000004'}
        ],
      });
    }
    return _json(404, {'code': 'RES-001', 'message': 'not found'});
  }

  @override
  void close({bool force = false}) {}
}

Future<_FakeApi> _pump(WidgetTester tester, {String password = 'right'}) async {
  final fake = _FakeApi(acceptPassword: 'right');
  final dio = Dio()..httpClientAdapter = fake;
  await tester.pumpWidget(SeipApp(session: SeipSession(dio: dio, baseUrl: 'https://api.test/api/v1')));
  await tester.enterText(find.byKey(const Key('email')), 'kru@seip.local');
  await tester.enterText(find.byKey(const Key('password')), password);
  await tester.tap(find.byKey(const Key('submit')));
  await tester.pumpAndSettle();
  return fake;
}

void main() {
  testWidgets('sign-in calls login, then /auth/me with the bearer token', (tester) async {
    final fake = await _pump(tester);
    expect(find.byKey(const Key('displayName')), findsOneWidget);
    expect(find.text('ครูสมศรี ใจดี'), findsOneWidget);
    expect(fake.seen, ['POST /auth/login', 'GET /auth/me Bearer tok-1']);
  });

  testWidgets('AUTH-001 shows one message for any bad credential', (tester) async {
    final fake = await _pump(tester, password: 'wrong');
    expect(find.byKey(const Key('error')), findsOneWidget);
    expect(find.text('อีเมลหรือรหัสผ่านไม่ถูกต้อง'), findsOneWidget);
    expect(fake.seen, ['POST /auth/login'], reason: 'no /auth/me without a token');
  });
}
