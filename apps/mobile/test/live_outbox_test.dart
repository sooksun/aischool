// FR-006 / FR-009 against the real API, SeaweedFS and worker. Skipped unless
// SEIP_API_URL is set (see live_api_test.dart). A 17 MiB file is two S3
// multipart parts; the connection "drops" after the first, a new engine over the
// same store resumes, and once the worker has re-hashed and scanned the bytes the
// local copy is deleted.
import 'dart:io';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:seip_api/seip_api.dart';
import 'package:seip_mobile/src/api.dart';
import 'package:seip_mobile/src/outbox.dart';

class _DropAfter implements ObjectStore {
  _DropAfter(this.inner, this.limit);
  final ObjectStore inner;
  final int limit;
  int sent = 0;
  @override
  Future<void> put(PresignedRequest request, List<int> bytes) async {
    if (sent >= limit) throw DioException(requestOptions: RequestOptions(path: request.url), type: DioExceptionType.connectionError);
    await inner.put(request, bytes);
    sent++;
  }
}

void main() {
  final url = Platform.environment['SEIP_API_URL'];
  test('a 17 MiB capture survives a dropped connection and a restart, then its local copy goes', () async {
    final session = SeipSession(baseUrl: url!);
    await session.signIn('e2e-teacher@seip.local', 'e2e-teacher-password-1234');
    final categories = await session.api.taxonomy.listEvidenceCategories();
    final category = categories.firstWhere((c) => c.allowedMimeTypes.contains('video/mp4'));

    final dir = await Directory.systemTemp.createTemp('seip-outbox');
    final path = '${dir.path}/lesson.mp4';
    final r = Random(7);
    await File(path).writeAsBytes(List.generate(17 * 1024 * 1024, (_) => r.nextInt(256)));
    final store = MemoryOutboxStore();
    final item = OutboxItem(
      clientUuid: newClientUuid(), categoryId: category.id, title: 'outbox live', filename: 'lesson.mp4',
      contentType: 'video/mp4', byteSize: await File(path).length(), sha256: await sha256OfFile(path), path: path, durationMs: 60000,
    );

    final dropping = Outbox(api: session.api, store: store, bytes: LocalFileBytes(), objects: _DropAfter(DioObjectStore(), 1));
    await dropping.add(item);
    await dropping.drain();
    expect((await store.load()).single.state, OutboxState.uploading, reason: 'dropped after part 1 (${store.json})');

    final restarted = Outbox(api: session.api, store: store, bytes: LocalFileBytes(), objects: _DropAfter(DioObjectStore(), 1));
    await restarted.drain();
    expect((restarted.objects as _DropAfter).sent, 1, reason: 'only the missing part was sent');
    final evidenceId = (await store.load()).single.evidenceId!;

    // Wait for the worker's re-hash. Without a scanner (SCAN_PROVIDER=none) the
    // file is honestly `unscanned`, and the outbox must keep the local copy;
    // with one, a clean verdict lets it go.
    EvidenceFile? file;
    final deadline = DateTime.now().add(const Duration(seconds: 90));
    while (DateTime.now().isBefore(deadline)) {
      file = (await session.api.evidence.getEvidence(evidenceId: evidenceId)).files.single;
      if (file.sha256VerifiedAt != null && file.scanStatus != ScanStatus.pending) break;
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    expect(file!.sha256VerifiedAt, isNotNull, reason: 'the server re-hashed the reassembled bytes and they matched');
    await restarted.drain();
    if (file.scanStatus == ScanStatus.clean || file.scanStatus == ScanStatus.sanitised) {
      expect(await store.load(), isEmpty);
      expect(File(path).existsSync(), isFalse, reason: 'the local copy is gone');
    } else {
      expect((await store.load()).single.state, OutboxState.verifying);
      expect(File(path).existsSync(), isTrue, reason: 'no scan verdict, so the copy stays');
      await dir.delete(recursive: true);
    }
  }, skip: url == null ? 'SEIP_API_URL not set' : false, timeout: const Timeout(Duration(minutes: 3)));
}
