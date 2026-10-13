// FR-006 / FR-009 against a fake API and object store that keep state the way
// the real ones do (Idempotency-Key replay, ListParts, session expiry, re-hash +
// scan before the local copy may go).
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:seip_api/seip_api.dart';
import 'package:seip_mobile/src/outbox.dart';

const partSize = 4;

class _FakeServer implements HttpClientAdapter {
  bool offline = false;
  final evidenceByKey = <String, String>{};
  final sessionsByKey = <String, Map<String, Object?>>{};
  final sessions = <String, Map<String, Object?>>{};
  final parts = <String, Set<int>>{};
  final files = <String, List<Map<String, Object?>>>{}; // evidenceId -> files
  int evidenceCreated = 0;
  int sessionsCreated = 0;
  var scan = 'clean';
  var verified = true;
  int _n = 0;
  String _id(String p) => '00000000-0000-4000-8000-${(++_n).toString().padLeft(12, '0')}-$p'.substring(0, 36);

  ResponseBody _json(int status, Object body) => ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: ['application/json'],
    },
  );

  Map<String, Object?> _session(Map<String, Object?> s) => {...s, 'parts_received': (parts[s['id']] ?? {}).toList()..sort()};

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    if (offline) throw DioException(requestOptions: o, type: DioExceptionType.connectionError);
    final now = DateTime.now().toUtc().toIso8601String();
    final data = o.data is Map ? (o.data as Map).cast<String, Object?>() : <String, Object?>{};
    final key = '${o.headers['Idempotency-Key']}';
    final p = o.path;
    if (o.method == 'POST' && p == '/evidence') {
      final id = evidenceByKey.putIfAbsent(key, () {
        evidenceCreated++;
        return _id('e');
      });
      return _json(201, {
        'id': id,
        'category_id': data['category_id'],
        'title': data['title'],
        'status': 'draft',
        'created_at': now,
        'updated_at': now,
        'owner_person_id': 'p',
        'origin_school_id': 's',
        'kind': 'file',
        'version': 1,
      });
    }
    if (o.method == 'POST' && p == '/uploads') {
      final s = sessionsByKey.putIfAbsent(key, () {
        sessionsCreated++;
        final byteSize = data['byte_size']! as int;
        final s = <String, Object?>{
          'id': _id('u'),
          'evidence_id': data['evidence_id'],
          'file_id': _id('f'),
          'protocol': 's3_multipart',
          'byte_size': byteSize,
          'part_size': partSize,
          'part_count': (byteSize + partSize - 1) ~/ partSize,
          'status': 'open',
          'expires_at': now,
        };
        sessions[s['id']! as String] = s;
        return s;
      });
      return _json(201, _session(s));
    }
    final m = RegExp(r'^/uploads/([^/]+)(/part-urls|/complete)?$').firstMatch(p);
    if (m != null) {
      final s = sessions[m[1]]!;
      if (m[2] == null) return _json(200, _session(s));
      if (m[2] == '/part-urls') {
        return _json(200, {
          'parts': [
            for (final n in data['part_numbers']! as List)
              {
                'part_number': n,
                'request': {'url': 'https://s3.test/${s['id']}/$n', 'method': 'PUT', 'expires_at': now},
              },
          ],
        });
      }
      final have = parts[s['id']] ?? {};
      if (have.length != s['part_count']) return _json(422, {'code': 'UPL-003', 'message': 'parts missing'});
      s['status'] = 'completed';
      final file = <String, Object?>{
        'id': s['file_id'],
        'evidence_id': s['evidence_id'],
        'content_type': 'video/mp4',
        'byte_size': s['byte_size'],
        'scan_status': 'pending',
        'uploaded_at': now,
        'role': 'original',
        'media_state': 'processing',
      };
      final list = files.putIfAbsent(s['evidence_id']! as String, () => []);
      if (!list.any((f) => f['id'] == file['id'])) list.add(file);
      return _json(200, file);
    }
    final e = RegExp(r'^/evidence/([^/]+)$').firstMatch(p);
    if (o.method == 'GET' && e != null) {
      return _json(200, {
        'id': e[1],
        'category_id': 'c',
        'title': 't',
        'status': 'active',
        'created_at': now,
        'updated_at': now,
        'owner_person_id': 'p',
        'origin_school_id': 's',
        'kind': 'file',
        'version': 1,
        'mappings': [],
        'files': [
          for (final f in files[e[1]] ?? const <Map<String, Object?>>[])
            {...f, 'scan_status': scan, 'sha256_verified_at': verified ? now : null},
        ],
      });
    }
    return _json(404, {'code': 'RES-001', 'message': p});
  }

  @override
  void close({bool force = false}) {}
}

class _FakeObjects implements ObjectStore {
  _FakeObjects(this.server);
  final _FakeServer server;
  final sent = <String>[];
  int? failAfter;

  @override
  Future<void> put(PresignedRequest request, List<int> bytes) async {
    if (failAfter != null && sent.length >= failAfter!) {
      throw DioException(
        requestOptions: RequestOptions(path: request.url),
        type: DioExceptionType.connectionError,
      );
    }
    final seg = Uri.parse(request.url).pathSegments;
    sent.add('${seg[1]}:${bytes.length}');
    server.parts.putIfAbsent(seg[0], () => {}).add(int.parse(seg[1]));
  }
}

class _FakeBytes implements LocalBytes {
  final data = <String, List<int>>{};
  @override
  Future<List<int>> read(String path, int offset, int length) async => data[path]!.sublist(offset, offset + length);
  @override
  Future<void> delete(String path) async => data.remove(path);
}

({Outbox outbox, _FakeServer server, _FakeObjects objects, _FakeBytes bytes, MemoryOutboxStore store}) _make({
  MemoryOutboxStore? store,
  _FakeServer? server,
  _FakeBytes? bytes,
}) {
  final s = server ?? _FakeServer();
  final api = SeipApi(Dio()..httpClientAdapter = s, baseUrl: 'https://api.test/api/v1');
  final st = store ?? MemoryOutboxStore();
  final b = bytes ?? _FakeBytes();
  final objects = _FakeObjects(s);
  return (outbox: Outbox(api: api, store: st, bytes: b, objects: objects), server: s, objects: objects, bytes: b, store: st);
}

OutboxItem _item(String path, int size) => OutboxItem(
  clientUuid: newClientUuid(),
  categoryId: 'c',
  title: 'สอนอ่าน',
  filename: 'lesson.mp4',
  contentType: 'video/mp4',
  byteSize: size,
  sha256: 'a' * 64,
  path: path,
);

void main() {
  test('offline capture waits, then goes up when the network is back; the local copy goes only after verify + scan', () async {
    final m = _make();
    m.bytes.data['/private/a'] = List.generate(10, (i) => i);
    m.server.offline = true;
    await m.outbox.add(_item('/private/a', 10));
    await m.outbox.drain();
    expect((await m.outbox.items()).single.state, OutboxState.queued, reason: 'still waiting, nothing lost');

    m.server.offline = false;
    m.server.scan = 'pending';
    await m.outbox.drain();
    expect((await m.outbox.items()).single.state, OutboxState.verifying);
    expect(m.bytes.data.containsKey('/private/a'), isTrue, reason: 'kept until the server says the bytes are good');
    expect(m.objects.sent, ['1:4', '2:4', '3:2']);

    m.server.scan = 'clean';
    await m.outbox.drain();
    expect(await m.outbox.items(), isEmpty);
    expect(m.bytes.data.containsKey('/private/a'), isFalse);
  });

  test('a dropped connection resumes from the parts the server has; a restart (new engine, same store) carries on', () async {
    final first = _make();
    first.bytes.data['/private/v'] = List.generate(18, (i) => i); // 5 parts
    await first.outbox.add(_item('/private/v', 18));
    first.objects.failAfter = 2;
    await first.outbox.drain();
    expect(first.objects.sent, ['1:4', '2:4']);

    // The app was killed. A new engine over the same store and server.
    final again = _make(store: first.store, server: first.server, bytes: first.bytes);
    await again.outbox.drain();
    expect(again.objects.sent, ['3:4', '4:4', '5:2'], reason: 'confirmed parts are never sent twice');
    expect(await again.outbox.items(), isEmpty);
    expect(first.server.sessionsCreated, 1);
  });

  test('an expired session is replaced automatically', () async {
    final m = _make();
    m.bytes.data['/private/x'] = List.generate(8, (i) => i);
    await m.outbox.add(_item('/private/x', 8));
    m.objects.failAfter = 1;
    await m.outbox.drain();
    for (final s in m.server.sessions.values) {
      s['status'] = 'expired';
    }
    m.objects.failAfter = null;
    await m.outbox.drain();
    expect(m.server.sessionsCreated, 2);
    expect(await m.outbox.items(), isEmpty);
  });

  test('replaying 20 times while flaky never makes a second item', () async {
    final m = _make();
    m.bytes.data['/private/r'] = List.generate(6, (i) => i);
    await m.outbox.add(_item('/private/r', 6));
    for (var i = 0; i < 20; i++) {
      m.server.offline = i.isEven;
      await m.outbox.drain();
    }
    m.server.offline = false;
    await m.outbox.drain();
    expect(m.server.evidenceCreated, 1);
    expect(m.server.sessionsCreated, 1);
    expect(await m.outbox.items(), isEmpty);
  });

  test('a blocked file stays in the outbox for the person to decide', () async {
    final m = _make();
    m.bytes.data['/private/b'] = [1, 2, 3];
    await m.outbox.add(_item('/private/b', 3));
    m.server.scan = 'blocked';
    await m.outbox.drain();
    expect((await m.outbox.items()).single.state, OutboxState.failed);
    expect(m.bytes.data.containsKey('/private/b'), isTrue);
  });

  test('FR-001: three photos in one group make one evidence item with three files', () async {
    final m = _make();
    final group = newClientUuid();
    for (final n in [1, 2, 3]) {
      m.bytes.data['/private/p$n'] = List.generate(5, (i) => i);
      await m.outbox.add(
        OutboxItem(
          clientUuid: newClientUuid(),
          groupUuid: group,
          categoryId: 'c',
          title: 'กิจกรรมวันภาษาไทย',
          filename: 'p$n.jpg',
          contentType: 'image/jpeg',
          byteSize: 5,
          sha256: 'a' * 64,
          path: '/private/p$n',
        ),
      );
    }
    m.server.scan = 'pending';
    await m.outbox.drain();
    expect(m.server.evidenceCreated, 1, reason: 'one item for the whole group');
    expect(m.server.sessionsCreated, 3);
    final items = await m.outbox.items();
    expect(items.map((i) => i.evidenceId).toSet().length, 1);
    expect(groupOutbox(items).single.length, 3);
    expect(groupState(items), OutboxState.verifying);
    expect(m.server.files.values.single.length, 3);

    m.server.scan = 'clean';
    await m.outbox.drain();
    expect(await m.outbox.items(), isEmpty);
    expect(m.bytes.data, isEmpty);
  });
}
