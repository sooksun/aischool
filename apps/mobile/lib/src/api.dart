import 'package:dio/dio.dart';
import 'package:seip_api/seip_api.dart';

/// Base URL comes from `--dart-define=SEIP_API_URL=…` so one build can point at
/// dev, staging or production. The Android emulator reaches the host as 10.0.2.2.
const apiBaseUrl = String.fromEnvironment(
  'SEIP_API_URL',
  defaultValue: 'http://10.0.2.2:3011/api/v1',
);

/// Holds the session and the generated client. P0 keeps tokens in memory only:
/// the Keycloak PKCE flow (ADR-0014, P1) replaces this with
/// flutter_appauth + flutter_secure_storage, so nothing here is persisted.
class SeipSession {
  SeipSession({Dio? dio, String baseUrl = apiBaseUrl})
      : _dio = dio ?? Dio(BaseOptions(connectTimeout: const Duration(seconds: 10))) {
    _dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      final token = _accessToken;
      if (token != null) options.headers['Authorization'] = 'Bearer $token';
      handler.next(options);
    }));
    api = SeipApi(_dio, baseUrl: baseUrl);
  }

  final Dio _dio;
  late final SeipApi api;
  String? _accessToken;

  bool get signedIn => _accessToken != null;

  Future<CurrentUser> signIn(String email, String password) async {
    final tokens = await api.auth.login(body: LoginRequest(email: email, password: password));
    _accessToken = tokens.accessToken;
    return api.auth.getCurrentUser();
  }

  void signOut() => _accessToken = null;
}
