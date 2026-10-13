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
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => HomeScreen(session: widget.session, me: me, services: widget.services),
      ),
    );
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
      setState(
        () => _error = switch (code) {
          'AUTH-004' => 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่',
          'AUTH-001' || 'AUTH-003' => 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
          _ => 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้',
        },
      );
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
              Text(
                _error!,
                key: const Key('error'),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
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
    final first = await _services.capture.capture(kind);
    if (first == null || !mounted) return;
    // FR-001: photos of one activity become one item — keep shooting until done.
    final files = [first];
    if (kind == CaptureKind.photo) {
      while (true) {
        if (!mounted) return;
        final more = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (_) => AlertDialog(
            title: Text('ถ่ายแล้ว ${files.length} รูป'),
            content: const Text('รูปทั้งหมดจะรวมเป็นหลักฐานชิ้นเดียว'),
            actions: [
              TextButton(key: const Key('morePhoto'), onPressed: () => Navigator.pop(context, true), child: const Text('ถ่ายเพิ่ม')),
              FilledButton(key: const Key('donePhotos'), onPressed: () => Navigator.pop(context, false), child: const Text('เสร็จ')),
            ],
          ),
        );
        if (more != true) break;
        final next = await _services.capture.capture(kind);
        if (next != null) files.add(next);
      }
    }
    List<EvidenceCategory> categories;
    try {
      categories = (await widget.session.api.taxonomy.listEvidenceCategories())
          .where((c) => files.every((f) => c.allowedMimeTypes.contains(f.contentType)))
          .toList();
    } catch (_) {
      categories = const [];
    }
    if (!mounted) return;
    if (categories.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('ยังไม่มีประเภทหลักฐานที่รับไฟล์ชนิดนี้ หรือยังไม่ได้เชื่อมต่อ')));
      return;
    }
    final picked = await showDialog<(EvidenceCategory, String)>(
      context: context,
      builder: (_) => _DetailsDialog(categories: categories, suggestedTitle: first.filename.replaceAll(RegExp(r'\.[^.]+$'), '')),
    );
    if (picked == null) return;
    final group = files.length > 1 ? newClientUuid() : null;
    for (final f in files) {
      await _outbox.add(
        OutboxItem(
          clientUuid: newClientUuid(),
          groupUuid: group,
          categoryId: picked.$1.id,
          title: picked.$2,
          filename: f.filename,
          contentType: f.contentType,
          byteSize: f.byteSize,
          sha256: await _services.hash(f.path),
          path: f.path,
          durationMs: f.durationMs,
        ),
      );
    }
    await _sync();
  }

  /// FR-015: a link or a typed note — no bytes; queued like a capture so it
  /// works offline and is created once.
  Future<void> _addLinkNote() async {
    List<EvidenceCategory> categories;
    try {
      categories = await widget.session.api.taxonomy.listEvidenceCategories();
    } catch (_) {
      categories = const [];
    }
    if (!mounted) return;
    if (categories.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('ยังไม่ได้เชื่อมต่อ — โหลดประเภทหลักฐานไม่ได้')));
      return;
    }
    final item = await showDialog<OutboxItem>(context: context, builder: (_) => LinkNoteDialog(categories: categories));
    if (item == null) return;
    await _outbox.add(item);
    await _sync();
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    return Scaffold(
      appBar: AppBar(
        title: const Text('หลักฐานของฉัน'),
        actions: [
          IconButton(
            key: const Key('signOut'),
            tooltip: 'ออกจากระบบ',
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await widget.session.signOut();
              if (!context.mounted) return;
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(
                  builder: (_) => LoginScreen(session: widget.session, services: widget.services),
                ),
              );
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _sync,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(me.displayName, key: const Key('displayName'), style: Theme.of(context).textTheme.titleLarge),
            Text(me.email),
            const Divider(),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  key: const Key('capturePhoto'),
                  onPressed: () => _capture(CaptureKind.photo),
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: const Text('ถ่ายรูป'),
                ),
                FilledButton.icon(
                  key: const Key('captureVideo'),
                  onPressed: () => _capture(CaptureKind.video),
                  icon: const Icon(Icons.videocam_outlined),
                  label: const Text('อัดวิดีโอ'),
                ),
                OutlinedButton.icon(
                  key: const Key('captureGallery'),
                  onPressed: () => _capture(CaptureKind.gallery),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: const Text('เลือกจากคลัง'),
                ),
                OutlinedButton.icon(
                  key: const Key('addLinkNote'),
                  onPressed: _addLinkNote,
                  icon: const Icon(Icons.link),
                  label: const Text('ลิงก์/บันทึก'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (_items.isEmpty)
              const Text('ไม่มีรายการรอส่ง', key: Key('outboxEmpty'))
            else
              // One row per evidence item; a group of photos shows its count
              // and the furthest-behind state among them.
              for (final group in groupOutbox(_items))
                ListTile(
                  key: Key('outbox-${group.first.evidenceClientUuid}'),
                  leading: Icon(group.any((i) => i.state == OutboxState.failed) ? Icons.error_outline : Icons.cloud_upload_outlined),
                  title: Text(group.first.title),
                  subtitle: Text(
                    group.length > 1 ? '${group.length} รูป · ${outboxLabel(groupState(group))}' : outboxLabel(group.first.state),
                  ),
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
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DropdownButtonFormField<EvidenceCategory>(
            key: const Key('category'),
            initialValue: _category,
            decoration: const InputDecoration(labelText: 'ประเภท'),
            items: [for (final c in widget.categories) DropdownMenuItem(value: c, child: Text(c.labelTh))],
            onChanged: (c) => setState(() => _category = c ?? _category),
          ),
          TextField(
            key: const Key('title'),
            controller: _title,
            decoration: const InputDecoration(labelText: 'ชื่อหลักฐาน'),
          ),
        ],
      ),
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

/// http(s) only — what the server accepts for a link.
bool isWebAddress(String value) {
  final u = Uri.tryParse(value.trim());
  return u != null && (u.scheme == 'http' || u.scheme == 'https') && u.host.isNotEmpty;
}

class LinkNoteDialog extends StatefulWidget {
  const LinkNoteDialog({super.key, required this.categories});
  final List<EvidenceCategory> categories;

  @override
  State<LinkNoteDialog> createState() => _LinkNoteDialogState();
}

class _LinkNoteDialogState extends State<LinkNoteDialog> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  late EvidenceCategory _category = widget.categories.first;
  EvidenceKind _kind = EvidenceKind.link;
  String? _error;

  void _save() {
    final title = _title.text.trim();
    final body = _body.text.trim();
    if (title.isEmpty) return setState(() => _error = 'กรุณาระบุชื่อหลักฐาน');
    if (_kind == EvidenceKind.link && !isWebAddress(body)) {
      return setState(() => _error = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
    }
    if (_kind == EvidenceKind.note && body.isEmpty) return setState(() => _error = 'กรุณาพิมพ์บันทึก');
    Navigator.pop(
      context,
      OutboxItem(
        clientUuid: newClientUuid(),
        categoryId: _category.id,
        title: title,
        kind: _kind,
        linkUrl: _kind == EvidenceKind.link ? body : null,
        noteText: _kind == EvidenceKind.note ? body : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final link = _kind == EvidenceKind.link;
    return AlertDialog(
      title: const Text('ลิงก์หรือบันทึก'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SegmentedButton<EvidenceKind>(
              key: const Key('linkNoteKind'),
              segments: const [
                ButtonSegment(value: EvidenceKind.link, label: Text('ลิงก์')),
                ButtonSegment(value: EvidenceKind.note, label: Text('บันทึก')),
              ],
              selected: {_kind},
              onSelectionChanged: (v) => setState(() => _kind = v.first),
            ),
            DropdownButtonFormField<EvidenceCategory>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'ประเภท'),
              items: [for (final c in widget.categories) DropdownMenuItem(value: c, child: Text(c.labelTh))],
              onChanged: (c) => setState(() => _category = c ?? _category),
            ),
            TextField(key: const Key('lnTitle'), controller: _title, decoration: const InputDecoration(labelText: 'ชื่อหลักฐาน')),
            TextField(
              key: const Key('lnBody'),
              controller: _body,
              keyboardType: link ? TextInputType.url : TextInputType.multiline,
              maxLines: link ? 1 : 6,
              decoration: InputDecoration(labelText: link ? 'ลิงก์ (https://…)' : 'บันทึก'),
            ),
            if (_error != null) Text(_error!, key: const Key('lnError'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
        FilledButton(key: const Key('lnSave'), onPressed: _save, child: const Text('บันทึก')),
      ],
    );
  }
}
