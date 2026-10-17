// SEIP ID sign-in (ADR-0014 §5) with a fake identity provider and a fake API:
// sign-in stores only the refresh token, a 401 renews once and replays, a
// revoked device is signed out, a restart restores the session, and a step-up
// asks for acr=mfa.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:seip_mobile/main.dart';
import 'package:seip_mobile/src/api.dart';
import 'package:seip_mobile/src/auth.dart';

class _FakeIdp implements OidcClient {
  int issued = 0;
  bool revoked = false;
  final authorizeAcrs = <String>[];
  final ended = <String?>[];

  OidcTokens _next() {
    issued++;
    return OidcTokens(accessToken: 'at-$issued', refreshToken: 'rt-$issued', idToken: 'id-$issued');
  }

  @override
  Future<OidcTokens> authorize({String acr = 'pwd'}) async {
    authorizeAcrs.add(acr);
    return _next();
  }

  @override
  Future<OidcTokens?> refresh(String refreshToken) async => revoked ? null : _next();

  @override
  Future<void> endSession(String? idToken) async => ended.add(idToken);
}

/// Accepts only the newest access token, like a 60 s token that has expired.
class _FakeApi implements HttpClientAdapter {
  _FakeApi(this.idp);
  final _FakeIdp idp;
  final seen = <String>[];

  ResponseBody _json(int status, Object body) => ResponseBody.fromString(
        jsonEncode(body),
        status,
        headers: {Headers.contentTypeHeader: ['application/json']},
      );

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    final auth = '${o.headers['Authorization'] ?? ''}';
    seen.add('${o.method} ${o.path} $auth'.trim());
    if (auth != 'Bearer at-${idp.issued}') return _json(401, {'code': 'AUTH-002', 'message': 'expired'});
    return _json(200, {
      'id': '0192d3a0-0000-7000-8000-000000000001',
      'email': 'kru@seip.local',
      'display_name': 'ครูสมศรี ใจดี',
      'memberships': [
        {'role': 'teacher', 'membership_scope': 'school', 'school_id': '0192d3a0-0000-7000-8000-000000000004'}
      ],
    });
  }

  @override
  void close({bool force = false}) {}
}

({SeipSession session, _FakeIdp idp, _FakeApi api, MemoryTokenStore store}) _make({MemoryTokenStore? store}) {
  final idp = _FakeIdp();
  final api = _FakeApi(idp);
  final s = store ?? MemoryTokenStore();
  final session = SeipSession(dio: Dio()..httpClientAdapter = api, baseUrl: 'https://api.test/api/v1', oidc: idp, store: s);
  return (session: session, idp: idp, api: api, store: s);
}

void main() {
  testWidgets('SEIP ID button signs in; only the refresh token is stored', (tester) async {
    final m = _make();
    await tester.pumpWidget(SeipApp(session: m.session));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('seipId')));
    await tester.pumpAndSettle();

    expect(find.text('ครูสมศรี ใจดี'), findsOneWidget);
    expect(m.idp.authorizeAcrs, ['pwd']);
    expect(m.store.value, 'rt-1');
    expect(m.api.seen, ['GET /auth/me Bearer at-1']);
  });

  test('an expired access token is renewed once and the request replayed', () async {
    final m = _make();
    await m.session.signInWithSeipId();
    m.idp.issued++; // the server moved on: at-1 no longer accepted
    final me = await m.session.api.auth.getCurrentUser();
    expect(me.displayName, 'ครูสมศรี ใจดี');
    expect(m.api.seen.last, 'GET /auth/me Bearer at-3');
    expect(m.store.value, 'rt-3', reason: 'the rotated refresh token replaces the old one');
  });

  test('concurrent 401s share one refresh', () async {
    final m = _make();
    await m.session.signInWithSeipId();
    m.idp.issued++;
    final before = m.idp.issued;
    await Future.wait([m.session.api.auth.getCurrentUser(), m.session.api.auth.getCurrentUser()]);
    expect(m.idp.issued, before + 1);
  });

  test('a revoked device is signed out and its stored session dropped', () async {
    final m = _make();
    var signedOut = false;
    m.session.onSignedOut = () => signedOut = true;
    await m.session.signInWithSeipId();
    m.idp.revoked = true;
    m.idp.issued++;
    await expectLater(m.session.api.auth.getCurrentUser(), throwsA(isA<DioException>()));
    expect(signedOut, isTrue);
    expect(m.session.signedIn, isFalse);
    expect(m.store.value, isNull);
  });

  testWidgets('a restart restores the session from the keystore', (tester) async {
    final store = MemoryTokenStore()..value = 'rt-from-last-run';
    final m = _make(store: store);
    await tester.pumpWidget(SeipApp(session: m.session));
    await tester.pumpAndSettle();
    expect(find.text('ครูสมศรี ใจดี'), findsOneWidget, reason: 'straight to the home screen');
    expect(m.idp.authorizeAcrs, isEmpty, reason: 'no browser round trip');
  });

  test('requests name the app and platform for the device list', () {
    expect(userAgent(TargetPlatform.iOS), 'SEIP-Mobile/$appVersion (ios)');
    expect(userAgent(TargetPlatform.android), 'SEIP-Mobile/$appVersion (android)');
  });

  test('step-up signs in again asking for the second factor', () async {
    final m = _make();
    await m.session.signInWithSeipId();
    await m.session.stepUp();
    expect(m.idp.authorizeAcrs, ['pwd', 'mfa']);
  });

  testWidgets('sign-out ends the Keycloak session and forgets the device session', (tester) async {
    final m = _make();
    await tester.pumpWidget(SeipApp(session: m.session));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('seipId')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('signOut')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('seipId')), findsOneWidget);
    expect(m.store.value, isNull);
    expect(m.idp.ended, ['id-1']);
  });
}
