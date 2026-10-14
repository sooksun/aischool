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
          {
            'id': 'cat-clip',
            'code': 'problem_clip',
            'label_th': 'คลิปสภาพปัญหา',
            'allowed_mime_types': ['video/mp4'],
            'max_duration_seconds': 30,
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

  testWidgets('FR-015: a link must be http(s); a good one is queued as รอส่ง', (tester) async {
    final session = SeipSession(dio: Dio()..httpClientAdapter = _OfflineApi(), baseUrl: 'https://api.test/api/v1');
    final store = MemoryOutboxStore();
    final services = AppServices(
      outboxFor: (api) => Outbox(api: api, store: store, bytes: _NoBytes(), objects: _NoObjects()),
      capture: _FakeCapture(),
      hash: (_) async => 'c' * 64,
    );
    const me = CurrentUser(id: 'u', email: 'kru@seip.local', displayName: 'ครูสมศรี', memberships: []);
    await tester.pumpWidget(MaterialApp(home: HomeScreen(session: session, me: me, services: services)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('addLinkNote')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('lnTitle')), 'คลิปสอน');
    await tester.enterText(find.byKey(const Key('lnBody')), 'javascript:alert(1)');
    await tester.tap(find.byKey(const Key('lnSave')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('lnError')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('lnBody')), 'https://youtu.be/abc');
    await tester.tap(find.byKey(const Key('lnSave')));
    await tester.pumpAndSettle();
    final queued = (await store.load()).single;
    expect(queued.kind, EvidenceKind.link);
    expect(queued.linkUrl, 'https://youtu.be/abc');
    expect(find.text('คลิปสอน'), findsOneWidget);
    expect(find.text('รอส่ง'), findsOneWidget);
  });

  testWidgets('FR-008: a large video on mobile data shows รอ Wi-Fi and offers ใช้เน็ตมือถือ', (tester) async {
    final session = SeipSession(dio: Dio()..httpClientAdapter = _OfflineApi(), baseUrl: 'https://api.test/api/v1');
    final store = MemoryOutboxStore();
    final services = AppServices(
      outboxFor: (api) => Outbox(api: api, store: store, bytes: _NoBytes(), objects: _NoObjects(), network: _Metered(), wifiOnlyAboveBytes: 1000),
      capture: _FakeCapture(),
      hash: (_) async => 'd' * 64,
    );
    const me = CurrentUser(id: 'u', email: 'kru@seip.local', displayName: 'ครูสมศรี', memberships: []);
    await tester.pumpWidget(MaterialApp(home: HomeScreen(session: session, me: me, services: services)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('captureVideo'))); // the fake clip is 1234 bytes
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('save')));
    await tester.pumpAndSettle();

    expect(find.text('รอ Wi-Fi (ไฟล์ใหญ่)'), findsOneWidget);
    final uuid = (await store.load()).single.evidenceClientUuid;
    await tester.tap(find.byKey(Key('mobileData-$uuid')));
    await tester.pumpAndSettle();
    expect((await store.load()).single.allowMobileData, isTrue);
    expect(find.text('รอ Wi-Fi (ไฟล์ใหญ่)'), findsNothing);
  });

  testWidgets('FR-003: a clip longer than its category allows is warned about, not stopped', (tester) async {
    final session = SeipSession(dio: Dio()..httpClientAdapter = _OfflineApi(), baseUrl: 'https://api.test/api/v1');
    final store = MemoryOutboxStore();
    final services = AppServices(
      outboxFor: (api) => Outbox(api: api, store: store, bytes: _NoBytes(), objects: _NoObjects()),
      capture: _FakeCapture(), // a 42 s clip
      hash: (_) async => 'e' * 64,
    );
    const me = CurrentUser(id: 'u', email: 'kru@seip.local', displayName: 'ครูสมศรี', memberships: []);
    await tester.pumpWidget(MaterialApp(home: HomeScreen(session: session, me: me, services: services)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('captureVideo')));
    await tester.pumpAndSettle();
    expect(find.text('ความยาว 0:42'), findsOneWidget);
    expect(find.byKey(const Key('durationWarning')), findsNothing, reason: 'วิดีโอการสอน has no cap in this data');

    await tester.tap(find.byKey(const Key('category')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('คลิปสภาพปัญหา').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('durationWarning')), findsOneWidget);
    expect(find.textContaining('ไม่เกิน 0:30'), findsOneWidget);
  });

  test('formatClock', () {
    expect(formatClock(42000), '0:42');
    expect(formatClock(600000), '10:00');
    expect(formatClock(3725000), '1:02:05');
  });
}

class _Metered implements NetworkInfo {
  @override
  Future<bool> isMetered() async => true;
}
