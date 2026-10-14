// FR-006: the outbox keeps draining while the app is closed. The OS (Android
// WorkManager, iOS BGTaskScheduler) runs drainInBackground about every 15
// minutes when a network is up; it restores the SEIP ID session from the
// keystore and sends what it can, exactly as the open app would.
//
// Refresh tokens rotate with reuse detection (Keycloak revokeRefreshToken,
// max reuse 0): if this task and the open app refreshed with the same token,
// Keycloak would end the session. So the task stands down while the app has
// been in the foreground recently, and the app renews from the stored token
// when someone else rotated it (SeipSession._renew).
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:seip_api/seip_api.dart';
import 'package:workmanager/workmanager.dart';

import 'api.dart';
import 'auth.dart';
import 'outbox.dart';

/// When the app was last seen in the foreground.
abstract class ForegroundMark {
  Future<DateTime?> read();
  Future<void> touch(DateTime now);
}

class MemoryForegroundMark implements ForegroundMark {
  DateTime? at;
  @override
  Future<DateTime?> read() async => at;
  @override
  Future<void> touch(DateTime now) async => at = now;
}

class SecureForegroundMark implements ForegroundMark {
  SecureForegroundMark({FlutterSecureStorage? storage}) : _s = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;
  static const _key = 'seip.foreground_at';
  @override
  Future<DateTime?> read() async => DateTime.tryParse(await _s.read(key: _key) ?? '');
  @override
  Future<void> touch(DateTime now) => _s.write(key: _key, value: now.toUtc().toIso8601String());
}

/// The open app touches the mark at least this often (HomeScreen's 30 s sync).
const foregroundQuiet = Duration(minutes: 2);

enum BackgroundResult { drained, signedOut, appOpen, failed }

/// One background run. Never throws: the OS only needs to know whether to retry.
Future<BackgroundResult> drainInBackground({
  required SeipSession session,
  required Outbox Function(SeipApi api) outboxFor,
  required ForegroundMark mark,
  DateTime Function() now = DateTime.now,
}) async {
  try {
    final seen = await mark.read();
    if (seen != null && now().difference(seen) < foregroundQuiet) return BackgroundResult.appOpen;
    if (await session.restore() == null) return BackgroundResult.signedOut; // the queue waits for sign-in
    await outboxFor(session.api).drain();
    return BackgroundResult.drained;
  } catch (_) {
    return BackgroundResult.failed;
  }
}

const backgroundTaskName = 'seip.outbox.drain';

/// The isolate entry point the OS calls; it must be top level.
@pragma('vm:entry-point')
void backgroundDispatcher() {
  Workmanager().executeTask((task, _) async {
    WidgetsFlutterBinding.ensureInitialized();
    final result = await drainInBackground(
      session: SeipSession(oidc: AppAuthOidcClient(), store: SecureTokenStore()),
      outboxFor: (api) => Outbox(
        api: api,
        store: SecureOutboxStore(),
        bytes: LocalFileBytes(),
        objects: DioObjectStore(),
        network: ConnectivityNetwork(),
      ),
      mark: SecureForegroundMark(),
    );
    return result != BackgroundResult.failed;
  });
}

/// Called once at start-up. Best effort: an OS that refuses background work
/// still has the foreground drain.
Future<void> scheduleBackgroundDrain() async {
  try {
    await Workmanager().initialize(backgroundDispatcher);
    await Workmanager().registerPeriodicTask(
      backgroundTaskName,
      backgroundTaskName,
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
    );
  } catch (_) {}
}
