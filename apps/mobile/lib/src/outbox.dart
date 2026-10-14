// FR-006 / FR-009: evidence captured offline waits in a local outbox that
// survives the app being closed, and its bytes go up resumably — a dropped
// connection resumes from the parts the server already has (ListParts, never
// the client's guess), an expired session is replaced automatically, and a
// replay never makes a second item (Idempotency-Key + client_uuid). The local
// copy is deleted only once the server has re-hashed the bytes and the scan
// passed (sha256_verified_at + clean/sanitised).
//
// Pure Dart behind three small seams, so the whole protocol runs in tests:
// OutboxStore (where the queue lives), LocalBytes (the captured file) and
// ObjectStore (the presigned PUTs, which carry no SEIP token).
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:crypto/crypto.dart' as crypto;
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:seip_api/seip_api.dart';

/// One captured item. Plain JSON so the store can be anything.
class OutboxItem {
  OutboxItem({
    required this.clientUuid,
    required this.categoryId,
    required this.title,
    this.filename = '',
    this.contentType = '',
    this.byteSize = 0,
    this.sha256 = '',
    this.path = '',
    this.kind = EvidenceKind.file,
    this.linkUrl,
    this.noteText,
    this.durationMs,
    this.groupUuid,
    this.evidenceId,
    this.uploadId,
    this.fileId,
    this.sessionGeneration = 0,
    this.state = OutboxState.queued,
    this.lastError,
    this.allowMobileData = false,
  });

  final String clientUuid;
  final String categoryId;
  final String title;
  final String filename;
  final String contentType;
  final int byteSize;
  final String sha256;

  /// Where the bytes are, in the app's private storage (never the public gallery).
  final String path;

  /// FR-015: a link or a note has no bytes — the item alone is the evidence.
  final EvidenceKind kind;
  final String? linkUrl;
  final String? noteText;

  /// Video/audio length as the capture screen measured it; video categories need it.
  final int? durationMs;

  /// FR-001: several captures (photos of one activity) that make one evidence
  /// item share this; the item's client_uuid is it. Null = one file, one item.
  final String? groupUuid;

  /// The evidence item's client_uuid — its dedupe key on the server.
  String get evidenceClientUuid => groupUuid ?? clientUuid;
  String? evidenceId;
  String? uploadId;
  String? fileId;

  /// Bumped when a session expired, so the replacement gets a fresh Idempotency-Key.
  int sessionGeneration;
  OutboxState state;
  String? lastError;

  /// FR-008: the person chose to send this large file over mobile data.
  bool allowMobileData;

  /// Not stored: set by the last drain when this file was held for Wi-Fi.
  bool waitingForWifi = false;

  Map<String, Object?> toJson() => {
    'client_uuid': clientUuid,
    'category_id': categoryId,
    'title': title,
    'filename': filename,
    'content_type': contentType,
    'byte_size': byteSize,
    'sha256': sha256,
    'path': path,
    'duration_ms': durationMs,
    'group_uuid': groupUuid,
    'allow_mobile_data': allowMobileData,
    'kind': kind.name,
    'link_url': linkUrl,
    'note_text': noteText,
    'evidence_id': evidenceId,
    'upload_id': uploadId,
    'file_id': fileId,
    'session_generation': sessionGeneration,
    'state': state.name,
    'last_error': lastError,
  };

  factory OutboxItem.fromJson(Map<String, Object?> j) => OutboxItem(
    clientUuid: j['client_uuid']! as String,
    categoryId: j['category_id']! as String,
    title: j['title']! as String,
    filename: j['filename']! as String,
    contentType: j['content_type']! as String,
    byteSize: j['byte_size']! as int,
    sha256: j['sha256']! as String,
    path: j['path']! as String,
    durationMs: j['duration_ms'] as int?,
    groupUuid: j['group_uuid'] as String?,
    allowMobileData: (j['allow_mobile_data'] as bool?) ?? false,
    kind: j['kind'] == null ? EvidenceKind.file : EvidenceKind.values.byName(j['kind']! as String),
    linkUrl: j['link_url'] as String?,
    noteText: j['note_text'] as String?,
    evidenceId: j['evidence_id'] as String?,
    uploadId: j['upload_id'] as String?,
    fileId: j['file_id'] as String?,
    sessionGeneration: (j['session_generation'] as int?) ?? 0,
    state: OutboxState.values.byName(j['state']! as String),
    lastError: j['last_error'] as String?,
  );
}

enum OutboxState {
  /// Waiting to be sent (รอส่ง).
  queued,

  /// Bytes on their way (กำลังส่ง).
  uploading,

  /// Sent; waiting for the server's re-hash and scan (กำลังตรวจ).
  verifying,

  /// The server refused the bytes (blocked) — kept for the person to decide.
  failed,
}

/// Where the queue lives. Must survive the app being killed.
abstract class OutboxStore {
  Future<List<OutboxItem>> load();
  Future<void> save(List<OutboxItem> items);
}

class MemoryOutboxStore implements OutboxStore {
  String? json;
  @override
  Future<List<OutboxItem>> load() async =>
      json == null ? [] : (jsonDecode(json!) as List).map((e) => OutboxItem.fromJson((e as Map).cast())).toList();
  @override
  Future<void> save(List<OutboxItem> items) async => json = jsonEncode(items.map((i) => i.toJson()).toList());
}

/// The queue's metadata in the platform keystore (encrypted at rest, excluded
/// from OS backup by the keystore itself). The bytes stay in the app's private
/// files directory; see LocalFileBytes.
class SecureOutboxStore implements OutboxStore {
  SecureOutboxStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'seip.outbox';
  final _memory = MemoryOutboxStore();

  @override
  Future<List<OutboxItem>> load() async {
    _memory.json = await _storage.read(key: _key);
    return _memory.load();
  }

  @override
  Future<void> save(List<OutboxItem> items) async {
    await _memory.save(items);
    await _storage.write(key: _key, value: _memory.json);
  }
}

/// The captured file's bytes. Android backup is off for the whole app
/// (AndroidManifest.xml); on iOS the capture screen must mark each file with
/// NSURLIsExcludedFromBackupKey, or iCloud backs it up (FR-006).
abstract class LocalBytes {
  Future<List<int>> read(String path, int offset, int length);
  Future<void> delete(String path);
}

class LocalFileBytes implements LocalBytes {
  @override
  Future<List<int>> read(String path, int offset, int length) async {
    final f = await File(path).open();
    try {
      await f.setPosition(offset);
      return await f.read(length);
    } finally {
      await f.close();
    }
  }

  @override
  Future<void> delete(String path) async {
    final f = File(path);
    if (await f.exists()) await f.delete();
  }
}

/// The presigned PUTs. Never sends the SEIP token: the URL is the credential.
abstract class ObjectStore {
  Future<void> put(PresignedRequest request, List<int> bytes);
}

class DioObjectStore implements ObjectStore {
  DioObjectStore({Dio? dio}) : _dio = dio ?? Dio();
  final Dio _dio;
  @override
  Future<void> put(PresignedRequest request, List<int> bytes) async {
    await _dio.put<void>(
      request.url,
      data: Stream.value(bytes),
      options: Options(headers: {...?request.headers, Headers.contentLengthHeader: bytes.length}),
    );
  }
}

/// SHA-256 of a captured file, streamed — the hash FR-010 asks the client to send.
Future<String> sha256OfFile(String path) async => (await crypto.sha256.bind(File(path).openRead()).first).toString();

/// A stable UUID from a seed: the same item always replays with the same
/// Idempotency-Key (the API requires a UUID there), across restarts.
String derivedUuid(String seed) => _uuidFrom(crypto.sha256.convert(utf8.encode(seed)).bytes.sublist(0, 16));

String _uuidFrom(List<int> bytes) {
  final b = [...bytes];
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

String newClientUuid([Random? random]) {
  final r = random ?? Random.secure();
  return _uuidFrom(List<int>.generate(16, (_) => r.nextInt(256)));
}

/// FR-008: whether the connection costs the person money (mobile data).
abstract class NetworkInfo {
  Future<bool> isMetered();
}

/// Never metered — tests and platforms without a connectivity plugin.
class UnmeteredNetwork implements NetworkInfo {
  const UnmeteredNetwork();
  @override
  Future<bool> isMetered() async => false;
}

class ConnectivityNetwork implements NetworkInfo {
  ConnectivityNetwork({Connectivity? connectivity}) : _c = connectivity ?? Connectivity();
  final Connectivity _c;
  @override
  Future<bool> isMetered() async {
    final r = await _c.checkConnectivity();
    final free = r.contains(ConnectivityResult.wifi) || r.contains(ConnectivityResult.ethernet);
    return !free && r.contains(ConnectivityResult.mobile);
  }
}

/// FR-008 default: files above 50 MB go over Wi-Fi only unless the person says otherwise.
const wifiOnlyAboveBytesDefault = 50 * 1000 * 1000;

class Outbox {
  Outbox({
    required this.api,
    required this.store,
    required this.bytes,
    required this.objects,
    this.network = const UnmeteredNetwork(),
    this.wifiOnlyAboveBytes = wifiOnlyAboveBytesDefault,
  });

  final NetworkInfo network;
  final int wifiOnlyAboveBytes;

  final SeipApi api;
  final OutboxStore store;
  final LocalBytes bytes;
  final ObjectStore objects;

  /// Called after every step that changed an item, so a screen can show รอส่ง /
  /// กำลังส่ง / กำลังตรวจ.
  void Function(List<OutboxItem> items)? onChanged;

  Future<void> add(OutboxItem item) async {
    final items = await store.load();
    if (items.any((i) => i.clientUuid == item.clientUuid)) return;
    await _save([...items, item]);
  }

  /// Entries the last drain held for Wi-Fi (not stored: it depends on the network now).
  final _heldForWifi = <String>{};

  Future<List<OutboxItem>> items() async {
    final items = await store.load();
    for (final i in items) {
      i.waitingForWifi = _heldForWifi.contains(i.clientUuid);
    }
    return items;
  }

  /// FR-008: send this file (or its whole group) over mobile data.
  Future<void> allowMobileData(String evidenceClientUuid) async {
    final items = await store.load();
    for (final i in items.where((i) => i.evidenceClientUuid == evidenceClientUuid)) {
      i.allowMobileData = true;
    }
    await _save(items);
  }

  /// Sends what it can. Stops at the first network failure (offline) and leaves
  /// everything as it was; the next drain picks up exactly there.
  Future<void> drain() async {
    final items = await store.load();
    final metered = await network.isMetered();
    for (final item in [...items]) {
      if (item.state == OutboxState.failed) continue;
      // FR-008: a large file waits for Wi-Fi before any bytes move; checking
      // a file the server already has costs nothing, so that still runs.
      item.waitingForWifi = metered &&
          item.kind == EvidenceKind.file &&
          item.byteSize > wifiOnlyAboveBytes &&
          !item.allowMobileData &&
          item.state != OutboxState.verifying;
      if (item.waitingForWifi) {
        _heldForWifi.add(item.clientUuid);
        onChanged?.call(items);
        continue;
      }
      _heldForWifi.remove(item.clientUuid);
      try {
        final done = await _advance(item, items);
        if (done) {
          items.remove(item);
          await _save(items);
        }
      } on DioException catch (e) {
        if (e.response == null) return; // offline: try again later
        final body = e.response!.data;
        item.lastError = body is Map ? '${body['code']}: ${body['message']}' : '${e.response!.statusCode}';
        await _save(items);
      }
    }
  }

  Future<void> _save(List<OutboxItem> items) async {
    await store.save(items);
    onChanged?.call(items);
  }

  /// True when the item is finished and its local copy deleted.
  Future<bool> _advance(OutboxItem item, List<OutboxItem> items) async {
    // A sibling in the same group may already have made the item.
    item.evidenceId ??= items
        .where((i) => i.groupUuid != null && i.groupUuid == item.groupUuid && i.evidenceId != null)
        .map((i) => i.evidenceId)
        .firstOrNull;
    if (item.evidenceId == null) {
      // Keyed on the group, so a replay — or a sibling racing after a crash —
      // gets the same row (the server also dedupes on client_uuid).
      final ev = await api.evidence.createEvidence(
        idempotencyKey: derivedUuid('evidence:${item.evidenceClientUuid}'),
        body: EvidenceCreate(
          categoryId: item.categoryId,
          title: item.title,
          kind: item.kind,
          clientUuid: item.evidenceClientUuid,
          linkUrl: item.linkUrl,
          noteText: item.noteText,
          containsLearners: EvidenceCreateContainsLearners.unknown,
        ),
      );
      for (final i in items) {
        if (i == item || (i.groupUuid != null && i.groupUuid == item.groupUuid)) i.evidenceId = ev.id;
      }
      await _save(items);
    }

    // FR-015: a link or note is finished once the server has the item.
    if (item.kind != EvidenceKind.file) return true;

    if (item.state != OutboxState.verifying) {
      UploadSession? session = item.uploadId == null ? null : await api.uploads.getUpload(uploadId: item.uploadId!);
      if (session != null && (session.status == UploadSessionStatus.expired || session.status == UploadSessionStatus.aborted)) {
        item.sessionGeneration++;
        session = null;
      }
      session ??= await api.uploads.createUpload(
        idempotencyKey: derivedUuid('upload:${item.clientUuid}:${item.sessionGeneration}'),
        body: UploadCreate(
          evidenceId: item.evidenceId!,
          filename: item.filename,
          contentType: item.contentType,
          byteSize: item.byteSize,
          checksumSha256: item.sha256,
          durationMs: item.durationMs,
        ),
      );
      item
        ..uploadId = session.id
        ..fileId = session.fileId
        ..state = OutboxState.uploading;
      await _save(items);

      if (session.status != UploadSessionStatus.completed) {
        await _sendMissingParts(item, session);
        await api.uploads.completeUpload(
          uploadId: session.id,
          body: UploadComplete(partCount: session.partCount),
        );
      }
      item.state = OutboxState.verifying;
      await _save(items);
    }

    final detail = await api.evidence.getEvidence(evidenceId: item.evidenceId!);
    final file = detail.files.where((f) => f.id == item.fileId).firstOrNull;
    if (file == null) return false;
    if (file.scanStatus == ScanStatus.blocked) {
      item.state = OutboxState.failed;
      await _save(items);
      return false;
    }
    final passed = file.scanStatus == ScanStatus.clean || file.scanStatus == ScanStatus.sanitised;
    if (file.sha256VerifiedAt == null || !passed) return false;
    await bytes.delete(item.path);
    return true;
  }

  Future<void> _sendMissingParts(OutboxItem item, UploadSession session) async {
    if (session.protocol == UploadProtocol.singlePut) {
      if (session.partsReceived.isNotEmpty) return;
      await objects.put(session.singlePut!, await bytes.read(item.path, 0, item.byteSize));
      return;
    }
    final have = session.partsReceived.toSet();
    final missing = [
      for (var n = 1; n <= session.partCount; n++)
        if (!have.contains(n)) n,
    ];
    for (var i = 0; i < missing.length; i += 100) {
      final batch = missing.sublist(i, min(i + 100, missing.length));
      final urls = await api.uploads.signUploadParts(
        uploadId: session.id,
        body: UploadPartUrlsRequest(partNumbers: batch),
      );
      for (final part in urls.parts) {
        final offset = (part.partNumber - 1) * session.partSize;
        final length = min(session.partSize, item.byteSize - offset);
        await objects.put(part.request, await bytes.read(item.path, offset, length));
      }
    }
  }
}

/// Outbox entries per evidence item, in queue order (FR-001 groups).
List<List<OutboxItem>> groupOutbox(List<OutboxItem> items) {
  final groups = <String, List<OutboxItem>>{};
  for (final i in items) {
    (groups[i.evidenceClientUuid] ??= []).add(i);
  }
  return groups.values.toList();
}

/// A group is as far along as its slowest file; any refused file shows it.
OutboxState groupState(List<OutboxItem> group) {
  if (group.any((i) => i.state == OutboxState.failed)) return OutboxState.failed;
  return group.map((i) => i.state).reduce((a, b) => a.index <= b.index ? a : b);
}
