// FR-001 / FR-003 / FR-004: what the capture screen gets from the device — a
// photo or video from the camera, or something already in the gallery — copied
// into the app's private storage so the outbox owns it (never the public
// gallery, FR-006). Behind CaptureSource so widget tests need no device.
import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:video_player/video_player.dart';

enum CaptureKind { photo, video, gallery }

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

class DeviceCaptureSource implements CaptureSource {
  DeviceCaptureSource({ImagePicker? picker}) : _picker = picker ?? ImagePicker();
  final ImagePicker _picker;

  @override
  Future<CapturedFile?> capture(CaptureKind kind) async {
    final XFile? x = switch (kind) {
      CaptureKind.photo => await _picker.pickImage(source: ImageSource.camera, imageQuality: 90),
      CaptureKind.video => await _picker.pickVideo(source: ImageSource.camera, maxDuration: const Duration(minutes: 10)),
      CaptureKind.gallery => await _picker.pickMedia(),
    };
    if (x == null) return null;

    // The app's own support directory: private, and not the shared gallery.
    final dir = Directory('${(await getApplicationSupportDirectory()).path}/outbox');
    await dir.create(recursive: true);
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
