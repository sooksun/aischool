import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:seip_api/seip_api.dart';

import 'auth.dart';

/// Base URL comes from `--dart-define=SEIP_API_URL=…` so one build can point at
/// dev, staging or production. The Android emulator reaches the host as 10.0.2.2.
const apiBaseUrl = String.fromEnvironment(
  'SEIP_API_URL',
  defaultValue: 'http://10.0.2.2:3011/api/v1',
);

/// `--dart-define=SEIP_APP_VERSION=…` (the pubspec version by default).
const appVersion = String.fromEnvironment('SEIP_APP_VERSION', defaultValue: '0.1.0');

/// How the API labels this device in the person's device list (FR-093).
String userAgent([TargetPlatform? platform]) =>
    'SEIP-Mobile/$appVersion (${(platform ?? defaultTargetPlatform) == TargetPlatform.iOS ? 'ios' : 'android'})';

/// Holds the session and the generated client.
///
/// Two ways in until the end of P1: SEIP ID (Keycloak, PKCE in the system
/// browser — ADR-0014 §5) and the API's own email + password login. Only the
/// SEIP ID refresh token is persisted, in the platform keystore; access tokens
/// stay in memory.
class SeipSession {
  SeipSession({Dio? dio, String baseUrl = apiBaseUrl, this.oidc, TokenStore? store})
      : _dio = dio ?? Dio(BaseOptions(connectTimeout: const Duration(seconds: 10))),
        _store = store ?? MemoryTokenStore() {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        final token = _accessToken;
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        options.headers['User-Agent'] = userAgent();
        handler.next(options);
      },
      onError: _renewOn401,
    ));
    api = SeipApi(_dio, baseUrl: baseUrl);
  }

  final Dio _dio;
  final TokenStore _store;

  /// Null in a build without SEIP ID (and in tests that do not need it).
  final OidcClient? oidc;
  late final SeipApi api;
  String? _accessToken;
  String? _refreshToken;
  String? _idToken;
  Future<bool>? _renewing;

  bool get signedIn => _accessToken != null;

  /// Called when a refresh fails: the device's session was revoked or expired.
  void Function()? onSignedOut;

  Future<CurrentUser> signIn(String email, String password) async {
    final tokens = await api.auth.login(body: LoginRequest(email: email, password: password));
    _accessToken = tokens.accessToken;
    return api.auth.getCurrentUser();
  }

  /// SEIP ID sign-in. `acr: 'mfa'` is the step-up after an AUTH-006; it replaces
  /// the session, so the second factor is what this session proved.
  Future<CurrentUser> signInWithSeipId({String acr = 'pwd'}) async {
    final client = oidc;
    if (client == null) throw StateError('SEIP ID is not configured in this build');
    await _adopt(await client.authorize(acr: acr));
    return api.auth.getCurrentUser();
  }

  Future<CurrentUser> stepUp() => signInWithSeipId(acr: 'mfa');

  /// At start-up: a stored SEIP ID session, if the device still has one.
  Future<CurrentUser?> restore() async {
    final stored = await _store.read();
    if (stored == null || oidc == null) return null;
    final tokens = await oidc!.refresh(stored);
    if (tokens == null) {
      await _store.clear();
      return null;
    }
    await _adopt(tokens);
    return api.auth.getCurrentUser();
  }

  Future<void> signOut() async {
    final idToken = _idToken;
    _accessToken = null;
    _refreshToken = null;
    _idToken = null;
    await _store.clear();
    if (idToken != null) await oidc?.endSession(idToken);
  }

  Future<void> _adopt(OidcTokens t) async {
    _accessToken = t.accessToken;
    _refreshToken = t.refreshToken;
    _idToken = t.idToken ?? _idToken;
    await _store.write(t.refreshToken);
  }

  /// Access tokens last 60 s. On a 401, renew once (shared by concurrent
  /// requests: the refresh token rotates, so two refreshes would trip reuse
  /// detection) and replay the request; if the session is gone, sign out.
  Future<void> _renewOn401(DioException e, ErrorInterceptorHandler handler) async {
    final options = e.requestOptions;
    if (e.response?.statusCode != 401 || _refreshToken == null || options.extra['seip.renewed'] == true) {
      return handler.next(e);
    }
    // Renewed by another request since this one went out: just replay.
    final sentWith = options.headers['Authorization'];
    final renewed = sentWith != 'Bearer $_accessToken' && _accessToken != null
        ? true
        : await (_renewing ??= _renew().whenComplete(() => _renewing = null));
    if (!renewed) {
      await signOut();
      onSignedOut?.call();
      return handler.next(e);
    }
    options.extra['seip.renewed'] = true;
    options.headers['Authorization'] = 'Bearer $_accessToken';
    try {
      handler.resolve(await _dio.fetch(options));
    } on DioException catch (again) {
      handler.next(again);
    }
  }

  Future<bool> _renew() async {
    // The background drain may have rotated the token since this session read
    // it; reusing the old one would trip Keycloak's reuse detection.
    final stored = await _store.read();
    final refresh = stored ?? _refreshToken;
    final client = oidc;
    if (refresh == null || client == null) return false;
    final tokens = await client.refresh(refresh);
    if (tokens == null) return false;
    await _adopt(tokens);
    return true;
  }
}
