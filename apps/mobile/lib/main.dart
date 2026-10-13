import 'package:flutter/material.dart';

import 'src/api.dart';
import 'src/auth.dart';
import 'src/screens.dart';

void main() => runApp(SeipApp(
      session: SeipSession(oidc: AppAuthOidcClient(), store: SecureTokenStore()),
    ));

class SeipApp extends StatelessWidget {
  const SeipApp({super.key, required this.session, this.services});
  final SeipSession session;

  /// Device capture and the offline outbox; tests pass fakes.
  final AppServices? services;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SEIP',
      theme: ThemeData(colorSchemeSeed: const Color(0xFF1B5E9A), useMaterial3: true),
      home: LoginScreen(session: session, services: services),
    );
  }
}
