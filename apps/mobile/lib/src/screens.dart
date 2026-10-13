import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:seip_api/seip_api.dart';

import 'api.dart';
import 'capture.dart';
import 'outbox.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session, this.services});
  final SeipSession session;
  final AppServices? services;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // A device that signed in with SEIP ID before goes straight in, unless its
    // session was revoked or expired meanwhile.
    _run(widget.session.restore, quietWhenNone: true);
  }

  void _open(CurrentUser me) {
    Navigator.of(context).pushReplacement(MaterialPageRoute(
      builder: (_) => HomeScreen(session: widget.session, me: me, services: widget.services),
    ));
  }

  Future<void> _run(Future<CurrentUser?> Function() attempt, {bool quietWhenNone = false}) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final me = await attempt();
      if (!mounted) return;
      if (me != null) _open(me);
    } catch (_) {
      if (!quietWhenNone) setState(() => _error = 'เข้าสู่ระบบด้วย SEIP ID ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final me = await widget.session.signIn(_email.text.trim(), _password.text);
      if (!mounted) return;
      _open(me);
    } on DioException catch (e) {
      // The API answers AUTH-001 for unknown user and wrong password alike
      // (SEC-AUTH-5) — the app must not try to tell them apart either.
      final code = (e.response?.data is Map) ? (e.response!.data as Map)['code'] : null;
      setState(() => _error = switch (code) {
            'AUTH-004' => 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่',
            'AUTH-001' || 'AUTH-003' => 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
            _ => 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้',
          });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('SEIP')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.session.oidc != null) ...[
              FilledButton(
                key: const Key('seipId'),
                onPressed: _busy ? null : () => _run(widget.session.signInWithSeipId),
                child: const Text('เข้าสู่ระบบด้วย SEIP ID'),
              ),
              const SizedBox(height: 8),
              const Text('หรือใช้อีเมลและรหัสผ่านเดิม'),
            ],
            TextField(
              key: const Key('email'),
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'อีเมล'),
            ),
            TextField(
              key: const Key('password'),
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'รหัสผ่าน'),
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Text(_error!, key: const Key('error'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
            FilledButton(
              key: const Key('submit'),
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'),
            ),
          ],
        ),
      ),
    );
  }
}

/// What the home screen needs from the device. Tests pass fakes.
class AppServices {
  AppServices({required this.outboxFor, required this.capture, required this.hash});

  factory AppServices.device() => AppServices(
        outboxFor: (api) => Outbox(api: api, store: SecureOutboxStore(), bytes: LocalFileBytes(), objects: DioObjectStore()),
        capture: DeviceCaptureSource(),
        hash: sha256OfFile,
      );

  final Outbox Function(SeipApi api) outboxFor;
  final CaptureSource capture;
  final Future<String> Function(String path) hash;
}

/// FR-017: the item's state in words a teacher reads at a glance.
String outboxLabel(OutboxState s) => switch (s) {
      OutboxState.queued => 'รอส่ง',
      OutboxState.uploading => 'กำลังส่ง',
      OutboxState.verifying => 'กำลังตรวจ',
      OutboxState.failed => 'ส่งไม่ผ่าน — ไฟล์ถูกระงับ',
    };

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.session, required this.me, this.services});
  final SeipSession session;
  final CurrentUser me;
  final AppServices? services;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final AppServices _services = widget.services ?? AppServices.device();
  late final Outbox _outbox = _services.outboxFor(widget.session.api)..onChanged = _show;
  List<OutboxItem> _items = [];
  bool _syncing = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _sync();
    // While the screen is open, keep trying: a drain that finds no network
    // simply stops and leaves the queue as it was.
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _sync());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _outbox.onChanged = null;
    super.dispose();
  }

  void _show(List<OutboxItem> items) {
    if (mounted) setState(() => _items = [...items]);
  }

  Future<void> _sync() async {
    if (_syncing) return;
    _syncing = true;
    try {
      _show(await _outbox.items());
      await _outbox.drain();
      _show(await _outbox.items());
    } catch (_) {
      // The keystore or the network is unavailable; the queue is untouched.
    } finally {
      _syncing = false;
    }
  }

  Future<void> _capture(CaptureKind kind) async {
    final file = await _services.capture.capture(kind);
    if (file == null || !mounted) return;
    List<EvidenceCategory> categories;
    try {
      categories = (await widget.session.api.taxonomy.listEvidenceCategories())
          .where((c) => c.allowedMimeTypes.contains(file.contentType))
          .toList();
    } catch (_) {
      categories = const [];
    }
    if (!mounted) return;
    if (categories.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('ยังไม่มีประเภทหลักฐานที่รับไฟล์ชนิดนี้ หรือยังไม่ได้เชื่อมต่อ')));
      return;
    }
    final picked = await showDialog<(EvidenceCategory, String)>(
      context: context,
      builder: (_) => _DetailsDialog(categories: categories, suggestedTitle: file.filename.replaceAll(RegExp(r'\.[^.]+$'), '')),
    );
    if (picked == null) return;
    await _outbox.add(OutboxItem(
      clientUuid: newClientUuid(), categoryId: picked.$1.id, title: picked.$2, filename: file.filename,
      contentType: file.contentType, byteSize: file.byteSize, sha256: await _services.hash(file.path), path: file.path,
      durationMs: file.durationMs,
    ));
    await _sync();
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    return Scaffold(
      appBar: AppBar(title: const Text('หลักฐานของฉัน'), actions: [
        IconButton(
          key: const Key('signOut'),
          tooltip: 'ออกจากระบบ',
          icon: const Icon(Icons.logout),
          onPressed: () async {
            await widget.session.signOut();
            if (!context.mounted) return;
            Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => LoginScreen(session: widget.session, services: widget.services)));
          },
        ),
      ]),
      body: RefreshIndicator(
        onRefresh: _sync,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(me.displayName, key: const Key('displayName'), style: Theme.of(context).textTheme.titleLarge),
            Text(me.email),
            const Divider(),
            Wrap(spacing: 8, runSpacing: 8, children: [
              FilledButton.icon(
                key: const Key('capturePhoto'), onPressed: () => _capture(CaptureKind.photo),
                icon: const Icon(Icons.photo_camera_outlined), label: const Text('ถ่ายรูป'),
              ),
              FilledButton.icon(
                key: const Key('captureVideo'), onPressed: () => _capture(CaptureKind.video),
                icon: const Icon(Icons.videocam_outlined), label: const Text('อัดวิดีโอ'),
              ),
              OutlinedButton.icon(
                key: const Key('captureGallery'), onPressed: () => _capture(CaptureKind.gallery),
                icon: const Icon(Icons.photo_library_outlined), label: const Text('เลือกจากคลัง'),
              ),
            ]),
            const SizedBox(height: 8),
            if (_items.isEmpty)
              const Text('ไม่มีรายการรอส่ง', key: Key('outboxEmpty'))
            else
              for (final item in _items)
                ListTile(
                  key: Key('outbox-${item.clientUuid}'),
                  leading: Icon(item.state == OutboxState.failed ? Icons.error_outline : Icons.cloud_upload_outlined),
                  title: Text(item.title),
                  subtitle: Text(outboxLabel(item.state)),
                ),
          ],
        ),
      ),
    );
  }
}

class _DetailsDialog extends StatefulWidget {
  const _DetailsDialog({required this.categories, required this.suggestedTitle});
  final List<EvidenceCategory> categories;
  final String suggestedTitle;

  @override
  State<_DetailsDialog> createState() => _DetailsDialogState();
}

class _DetailsDialogState extends State<_DetailsDialog> {
  late final _title = TextEditingController(text: widget.suggestedTitle);
  late EvidenceCategory _category = widget.categories.first;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('บันทึกหลักฐาน'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<EvidenceCategory>(
          key: const Key('category'),
          initialValue: _category,
          decoration: const InputDecoration(labelText: 'ประเภท'),
          items: [for (final c in widget.categories) DropdownMenuItem(value: c, child: Text(c.labelTh))],
          onChanged: (c) => setState(() => _category = c ?? _category),
        ),
        TextField(key: const Key('title'), controller: _title, decoration: const InputDecoration(labelText: 'ชื่อหลักฐาน')),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
        FilledButton(
          key: const Key('save'),
          onPressed: () => Navigator.pop(context, (_category, _title.text.trim().isEmpty ? widget.suggestedTitle : _title.text.trim())),
          child: const Text('บันทึก'),
        ),
      ],
    );
  }
}
