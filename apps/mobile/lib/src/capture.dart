// FR-001 / FR-003 / FR-004: what the capture screen gets from the device — a
// photo or video from the camera, or something already in the gallery — copied
// into the app's private storage so the outbox owns it (never the public
// gallery, FR-006). Behind CaptureSource so widget tests need no device.
import 'dart:io';
import 'dart:typed_data';

import 'package:cunning_document_scanner/cunning_document_scanner.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:video_player/video_player.dart';

enum CaptureKind { photo, video, gallery, scan }

class CapturedFile {
  const CapturedFile({required this.path, required this.filename, required this.contentType, required this.byteSize, this.durationMs});
  final String path;
  final String filename;
  final String contentType;
  final int byteSize;
  final int? durationMs;
}

abstract class CaptureSource {
  /// Null when the person cancelled.
  Future<CapturedFile?> capture(CaptureKind kind);
}

String contentTypeFor(String filename) {
  final ext = filename.split('.').last.toLowerCase();
  return switch (ext) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'heic' => 'image/heic',
    'mp4' => 'video/mp4',
    'mov' => 'video/quicktime',
    'pdf' => 'application/pdf',
    _ => 'application/octet-stream',
  };
}

/// FR-002: scanned pages (already cropped and de-skewed by the scanner) as
/// one PDF — one page per image, each page sized to its image so nothing is
/// cropped or stretched. Pure, so it is tested without a device.
Future<Uint8List> pagesToPdf(List<Uint8List> pages, {bool compress = true}) async {
  if (pages.isEmpty) throw ArgumentError('no pages');
  final doc = pw.Document(title: 'SEIP scan', creator: 'SEIP', compress: compress, version: compress ? PdfVersion.pdf_1_5 : PdfVersion.pdf_1_4);
  for (final bytes in pages) {
    final image = pw.MemoryImage(bytes);
    final w = (image.width ?? 595).toDouble(), h = (image.height ?? 842).toDouble();
    doc.addPage(pw.Page(pageFormat: PdfPageFormat(w, h), margin: pw.EdgeInsets.zero, build: (_) => pw.Image(image, fit: pw.BoxFit.fill)));
  }
  return doc.save();
}

class DeviceCaptureSource implements CaptureSource {
  DeviceCaptureSource({ImagePicker? picker}) : _picker = picker ?? ImagePicker();
  final ImagePicker _picker;

  Future<Directory> _outboxDir() async {
    // The app's own support directory: private, and not the shared gallery.
    final dir = Directory('${(await getApplicationSupportDirectory()).path}/outbox');
    await dir.create(recursive: true);
    return dir;
  }

  /// FR-002: the platform scanner (ML Kit on Android, VisionKit on iOS) finds
  /// the page edges and corrects perspective; the pages become one PDF.
  Future<CapturedFile?> _scan() async {
    final paths = await CunningDocumentScanner.getPictures(scannerSource: ScannerSource.camera);
    if (paths == null || paths.isEmpty) return null;
    final pdf = await pagesToPdf([for (final p in paths) await File(p).readAsBytes()]);
    for (final p in paths) {
      await File(p).delete().catchError((_) => File(p));
    }
    final name = 'scan-${DateTime.now().millisecondsSinceEpoch}.pdf';
    final target = '${(await _outboxDir()).path}/$name';
    await File(target).writeAsBytes(pdf, flush: true);
    return CapturedFile(path: target, filename: name, contentType: 'application/pdf', byteSize: pdf.length);
  }

  @override
  Future<CapturedFile?> capture(CaptureKind kind) async {
    if (kind == CaptureKind.scan) return _scan();
    final XFile? x = switch (kind) {
      CaptureKind.photo => await _picker.pickImage(source: ImageSource.camera, imageQuality: 90),
      CaptureKind.video => await _picker.pickVideo(source: ImageSource.camera, maxDuration: const Duration(minutes: 10)),
      CaptureKind.gallery => await _picker.pickMedia(),
      CaptureKind.scan => null, // handled above
    };
    if (x == null) return null;

    final dir = await _outboxDir();
    final name = x.name;
    final target = '${dir.path}/${DateTime.now().microsecondsSinceEpoch}-$name';
    await File(x.path).copy(target);
    final type = x.mimeType ?? contentTypeFor(name);
    int? durationMs;
    if (type.startsWith('video/')) {
      final c = VideoPlayerController.file(File(target));
      try {
        await c.initialize();
        durationMs = c.value.duration.inMilliseconds;
      } finally {
        await c.dispose();
      }
    }
    return CapturedFile(path: target, filename: name, contentType: type, byteSize: await File(target).length(), durationMs: durationMs);
  }
}

/// FR-004: what another app (LINE, Google Drive, Photos) shared to SEIP —
/// files as received, already copied into the outbox directory, or a link.
class SharedIn {
  const SharedIn({this.files = const [], this.link});
  final List<CapturedFile> files;
  final String? link;
  bool get isEmpty => files.isEmpty && link == null;
}

abstract class ShareInbox {
  /// What launched the app, if a share did (read once, then cleared).
  Future<SharedIn?> initial();

  /// Shares that arrive while the app is open.
  Stream<SharedIn> get incoming;
}

class NoShareInbox implements ShareInbox {
  const NoShareInbox();
  @override
  Future<SharedIn?> initial() async => null;
  @override
  Stream<SharedIn> get incoming => const Stream.empty();
}

/// The first http(s) address in shared text ("ดูคลิปนี้ https://youtu.be/x").
String? firstWebAddress(String text) {
  for (final m in RegExp(r'https?://[^\s<>"]+', caseSensitive: false).allMatches(text)) {
    final u = Uri.tryParse(m[0]!.replaceAll(RegExp(r'[).,;!?]+$'), ''));
    if (u != null && u.host.isNotEmpty) return u.toString();
  }
  return null;
}

class DeviceShareInbox implements ShareInbox {
  final _intent = ReceiveSharingIntent.instance;

  Future<SharedIn> _convert(List<SharedMediaFile> shared) async {
    final files = <CapturedFile>[];
    String? link;
    final dir = Directory('${(await getApplicationSupportDirectory()).path}/outbox');
    await dir.create(recursive: true);
    for (final m in shared) {
      if (m.type == SharedMediaType.text || m.type == SharedMediaType.url) {
        link ??= firstWebAddress(m.path);
        continue;
      }
      // The plugin's copy sits in a temp cache; the outbox keeps its own.
      final name = m.path.split('/').last;
      final target = '${dir.path}/${DateTime.now().microsecondsSinceEpoch}-$name';
      await File(m.path).copy(target);
      files.add(CapturedFile(
        path: target,
        filename: name,
        contentType: m.mimeType ?? contentTypeFor(name),
        byteSize: await File(target).length(),
        durationMs: m.duration,
      ));
    }
    return SharedIn(files: files, link: link);
  }

  @override
  Future<SharedIn?> initial() async {
    final shared = await _intent.getInitialMedia();
    if (shared.isEmpty) return null;
    final result = await _convert(shared);
    await _intent.reset();
    return result;
  }

  @override
  Stream<SharedIn> get incoming => _intent.getMediaStream().where((s) => s.isNotEmpty).asyncMap(_convert);
}
