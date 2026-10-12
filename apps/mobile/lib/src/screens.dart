import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:seip_api/seip_api.dart';

import 'api.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session});
  final SeipSession session;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final me = await widget.session.signIn(_email.text.trim(), _password.text);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => HomeScreen(session: widget.session, me: me),
      ));
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

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.session, required this.me});
  final SeipSession session;
  final CurrentUser me;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('หลักฐานของฉัน')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(me.displayName, key: const Key('displayName'), style: Theme.of(context).textTheme.titleLarge),
          Text(me.email),
          const Divider(),
          for (final m in me.memberships) ListTile(title: Text(m.role.name), subtitle: Text(m.schoolId ?? m.areaId ?? '')),
          const Divider(),
          const ListTile(
            leading: Icon(Icons.photo_camera_outlined),
            title: Text('ถ่าย / สแกน / อัดวิดีโอ'),
            subtitle: Text('P2 — capture + outbox ออฟไลน์ + อัปโหลดต่อได้'),
            enabled: false,
          ),
        ],
      ),
    );
  }
}
