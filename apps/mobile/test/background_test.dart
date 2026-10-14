// FR-006: the background drain — stands down while the app is open, waits for
// sign-in when signed out, otherwise drains the same queue the app uses.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:seip_api/seip_api.dart';
import 'package:seip_mobile/src/api.dart';
import 'package:seip_mobile/src/auth.dart';
import 'package:seip_mobile/src/background.dart';
import 'package:seip_mobile/src/outbox.dart';

class _Idp implements OidcClient {
  int issued = 0;
  final refreshedWith = <String>[];
  @override
  Future<OidcTokens> authorize({String acr = 'pwd'}) async => _next();
  @override
  Future<OidcTokens?> refresh(String refreshToken) async {
    refreshedWith.add(refreshToken);
    return _next();
  }

  OidcTokens _next() {
    issued++;
    return OidcTokens(accessToken: 'at-$issued', refreshToken: 'rt-$issued', idToken: 'id');
  }

  @override
  Future<void> endSession(String? idToken) async {}
}

/// /auth/me and POST /evidence (a note), accepting only the newest access token.
class _Api implements HttpClientAdapter {
  _Api(this.idp);
  final _Idp idp;
  int created = 0;
  ResponseBody _json(int status, Object body) =>
      ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: ['application/json']});
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    if (o.headers['Authorization'] != 'Bearer at-${idp.issued}') return _json(401, {'code': 'AUTH-002', 'message': 'expired'});
    final now = DateTime.now().toUtc().toIso8601String();
    if (o.path == '/auth/me') {
      return _json(200, {'id': 'u', 'email': 'kru@seip.local', 'display_name': 'ครู', 'memberships': []});
    }
    created++;
    return _json(201, {
      'id': '00000000-0000-4000-8000-000000000001', 'category_id': 'c', 'title': 't', 'status': 'active', 'created_at': now,
      'updated_at': now, 'owner_person_id': 'p', 'origin_school_id': 's', 'kind': 'note', 'version': 1,
    });
  }

  @override
  void close({bool force = false}) {}
}

class _NoBytes implements LocalBytes {
  @override
  Future<List<int>> read(String path, int offset, int length) async => [];
  @override
  Future<void> delete(String path) async {}
}

class _NoObjects implements ObjectStore {
  @override
  Future<void> put(PresignedRequest request, List<int> bytes) async {}
}

void main() {
  late _Idp idp;
  late _Api api;
  late MemoryTokenStore tokens;
  late MemoryOutboxStore queue;
  late SeipSession session;

  Outbox outboxFor(SeipApi a) => Outbox(api: a, store: queue, bytes: _NoBytes(), objects: _NoObjects());

  setUp(() async {
    idp = _Idp();
    api = _Api(idp);
    tokens = MemoryTokenStore();
    queue = MemoryOutboxStore();
    session = SeipSession(dio: Dio()..httpClientAdapter = api, baseUrl: 'https://api.test/api/v1', oidc: idp, store: tokens);
    await outboxFor(session.api).add(OutboxItem(clientUuid: newClientUuid(), categoryId: 'c', title: 'บันทึก', kind: EvidenceKind.note, noteText: 'x'));
  });

  test('signed in and the app closed: the queue drains', () async {
    await tokens.write('rt-0');
    final r = await drainInBackground(session: session, outboxFor: outboxFor, mark: MemoryForegroundMark());
    expect(r, BackgroundResult.drained);
    expect(api.created, 1);
    expect(await queue.load(), isEmpty);
  });

  test('the app was in the foreground a moment ago: stand down, refresh nothing', () async {
    await tokens.write('rt-0');
    final mark = MemoryForegroundMark()..at = DateTime.now().subtract(const Duration(seconds: 30));
    final r = await drainInBackground(session: session, outboxFor: outboxFor, mark: mark);
    expect(r, BackgroundResult.appOpen);
    expect(idp.refreshedWith, isEmpty, reason: 'no token rotation behind the open app');
    expect((await queue.load()).length, 1);
  });

  test('signed out: the queue is kept for the next sign-in', () async {
    final r = await drainInBackground(session: session, outboxFor: outboxFor, mark: MemoryForegroundMark());
    expect(r, BackgroundResult.signedOut);
    expect((await queue.load()).length, 1);
  });

  test('the open app renews with the token the background run rotated, not its stale copy', () async {
    await tokens.write('rt-0');
    await session.restore(); // the app holds rt-1
    expect(await tokens.read(), 'rt-1');
    // Meanwhile a background run rotated it: rt-1 -> rt-2 in the store.
    final bg = SeipSession(dio: Dio()..httpClientAdapter = api, baseUrl: 'https://api.test/api/v1', oidc: idp, store: tokens);
    await bg.restore();
    expect(await tokens.read(), 'rt-2');
    // The app's access token is now stale; its renewal must use rt-2.
    await session.api.auth.getCurrentUser();
    expect(idp.refreshedWith.last, 'rt-2');
  });
}
