// FR-001/003/004/017: capture on the home screen goes into the offline outbox
// and is listed with its status in Thai, even with no network.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:seip_api/seip_api.dart';
import 'package:seip_mobile/src/api.dart';
import 'package:seip_mobile/src/capture.dart';
import 'package:seip_mobile/src/outbox.dart';
import 'package:seip_mobile/src/screens.dart';

/// Only the category list answers; everything else is "no network".
class _OfflineApi implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    if (o.path == '/evidence-categories') {
      return ResponseBody.fromString(
        jsonEncode([
          {
            'id': 'cat-video',
            'code': 'lesson_video',
            'label_th': 'วิดีโอการสอน',
            'allowed_mime_types': ['video/mp4'],
            'required_for_dpa': false,
          },
          {
            'id': 'cat-photo',
            'code': 'activity_photo',
            'label_th': 'ภาพกิจกรรม',
            'allowed_mime_types': ['image/jpeg'],
            'required_for_dpa': false,
          },
        ]),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    }
    throw DioException(requestOptions: o, type: DioExceptionType.connectionError);
  }

  @override
  void close({bool force = false}) {}
}

class _FakeCapture implements CaptureSource {
  CaptureKind? asked;
  int shots = 0;
  @override
  Future<CapturedFile?> capture(CaptureKind kind) async {
    asked = kind;
    if (kind == CaptureKind.photo) {
      shots++;
      return CapturedFile(path: '/private/outbox/p$shots.jpg', filename: 'p$shots.jpg', contentType: 'image/jpeg', byteSize: 100);
    }
    return const CapturedFile(
      path: '/private/outbox/clip.mp4',
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      byteSize: 1234,
      durationMs: 42000,
    );
  }
}

class _NoBytes implements LocalBytes {
  @override
  Future<List<int>> read(String path, int offset, int length) async => List.filled(length, 0);
  @override
  Future<void> delete(String path) async {}
}

class _NoObjects implements ObjectStore {
  @override
  Future<void> put(PresignedRequest request, List<int> bytes) async {}
}

void main() {
  testWidgets('a video recorded offline is queued as รอส่ง with the chosen category and title', (tester) async {
    final session = SeipSession(dio: Dio()..httpClientAdapter = _OfflineApi(), baseUrl: 'https://api.test/api/v1');
    final store = MemoryOutboxStore();
    final capture = _FakeCapture();
    final services = AppServices(
      outboxFor: (api) => Outbox(api: api, store: store, bytes: _NoBytes(), objects: _NoObjects()),
      capture: capture,
      hash: (_) async => 'b' * 64,
    );
    const me = CurrentUser(id: 'u', email: 'kru@seip.local', displayName: 'ครูสมศรี', memberships: []);
    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(session: session, me: me, services: services),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('outboxEmpty')), findsOneWidget);

    await tester.tap(find.byKey(const Key('captureVideo')));
    await tester.pumpAndSettle();
    expect(capture.asked, CaptureKind.video);
    // Only categories that take video/mp4 are offered.
    expect(find.text('วิดีโอการสอน'), findsOneWidget);
    expect(find.text('ภาพกิจกรรม'), findsNothing);
    await tester.enterText(find.byKey(const Key('title')), 'สอนอ่านออกเสียง');
    await tester.tap(find.byKey(const Key('save')));
    await tester.pumpAndSettle();

    expect(find.text('สอนอ่านออกเสียง'), findsOneWidget);
    expect(find.text('รอส่ง'), findsOneWidget);
    final queued = (await store.load()).single;
    expect(queued.categoryId, 'cat-video');
    expect(queued.durationMs, 42000);
    expect(queued.sha256, 'b' * 64);
  });

  testWidgets('FR-001: three photos taken in a row are one item, listed once as "3 รูป"', (tester) async {
    final session = SeipSession(dio: Dio()..httpClientAdapter = _OfflineApi(), baseUrl: 'https://api.test/api/v1');
    final store = MemoryOutboxStore();
    final capture = _FakeCapture();
    final services = AppServices(
      outboxFor: (api) => Outbox(api: api, store: store, bytes: _NoBytes(), objects: _NoObjects()),
      capture: capture,
      hash: (_) async => 'c' * 64,
    );
    const me = CurrentUser(id: 'u', email: 'kru@seip.local', displayName: 'ครูสมศรี', memberships: []);
    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(session: session, me: me, services: services),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('capturePhoto')));
    await tester.pumpAndSettle();
    expect(find.text('ถ่ายแล้ว 1 รูป'), findsOneWidget);
    await tester.tap(find.byKey(const Key('morePhoto')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('morePhoto')));
    await tester.pumpAndSettle();
    expect(find.text('ถ่ายแล้ว 3 รูป'), findsOneWidget);
    await tester.tap(find.byKey(const Key('donePhotos')));
    await tester.pumpAndSettle();
    expect(find.text('ภาพกิจกรรม'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('title')), 'วันภาษาไทย');
    await tester.tap(find.byKey(const Key('save')));
    await tester.pumpAndSettle();

    final queued = await store.load();
    expect(queued.length, 3);
    expect(queued.map((i) => i.groupUuid).toSet().length, 1);
    expect(queued.first.groupUuid, isNotNull);
    expect(find.text('3 รูป · รอส่ง'), findsOneWidget);
    expect(find.text('วันภาษาไทย'), findsOneWidget);
  });
}
