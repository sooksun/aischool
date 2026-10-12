// Live check against a running API (P0 exit: "Flutter calls the API through the
// generated Dart client"). Skipped unless SEIP_API_URL is set, e.g.
//   SEIP_API_URL=http://127.0.0.1:3011/api/v1 flutter test test/live_api_test.dart
// Uses the e2e fixture teacher seeded by tests/e2e/global-setup.mjs.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:seip_mobile/src/api.dart';

void main() {
  final url = Platform.environment['SEIP_API_URL'];
  test('generated client signs in and reads the caller from the real API', () async {
    final session = SeipSession(baseUrl: url!);
    final me = await session.signIn('e2e-teacher@seip.local', 'e2e-teacher-password-1234');
    expect(me.email, 'e2e-teacher@seip.local');
    expect(me.memberships, isNotEmpty);
  }, skip: url == null ? 'SEIP_API_URL not set' : false);
}
