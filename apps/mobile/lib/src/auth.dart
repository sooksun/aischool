// SEIP ID sign-in for the app (ADR-0014 §5): OIDC authorization code + PKCE in
// the system browser (flutter_appauth), an offline session per device, and the
// refresh token in the platform keystore (flutter_secure_storage). The access
// token lives in memory only and lasts 60 s; revoking the device's session in
// Keycloak therefore cuts the app off at its next refresh.
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// `--dart-define=SEIP_OIDC_ISSUER=…`. On the Android emulator, run
/// `adb reverse tcp:8180 tcp:8180` and keep the default: the issuer in the
/// tokens must be the same URL the API trusts (KEYCLOAK_ISSUER).
const oidcIssuer = String.fromEnvironment(
  'SEIP_OIDC_ISSUER',
  defaultValue: 'http://localhost:8180/realms/seip',
);
const oidcClientId = 'seip-mobile';
const oidcRedirectUri = 'th.go.seip.app:/oauth2redirect';

class OidcTokens {
  const OidcTokens({required this.accessToken, required this.refreshToken, this.idToken});
  final String accessToken;
  final String refreshToken;
  final String? idToken;
}

/// The identity provider as the app needs it. [AppAuthOidcClient] in the app,
/// a fake in tests.
abstract class OidcClient {
  /// Signs in through the system browser. `acr` is `pwd`, or `mfa` for the
  /// second factor a step-up operation asks for (AUTH-006).
  Future<OidcTokens> authorize({String acr = 'pwd'});

  /// Null when the session is gone (revoked device, signed out elsewhere).
  Future<OidcTokens?> refresh(String refreshToken);

  Future<void> endSession(String? idToken);
}

class AppAuthOidcClient implements OidcClient {
  AppAuthOidcClient({FlutterAppAuth? appAuth}) : _appAuth = appAuth ?? const FlutterAppAuth();
  final FlutterAppAuth _appAuth;

  @override
  Future<OidcTokens> authorize({String acr = 'pwd'}) async {
    final r = await _appAuth.authorizeAndExchangeCode(AuthorizationTokenRequest(
      oidcClientId,
      oidcRedirectUri,
      issuer: oidcIssuer,
      // offline_access: a session for this device that outlives the browser SSO
      // session, listed and revocable per device (ADR-0014 §5).
      scopes: const ['openid', 'offline_access'],
      additionalParameters: {'acr_values': acr},
      allowInsecureConnections: oidcIssuer.startsWith('http://'),
    ));
    return OidcTokens(accessToken: r.accessToken!, refreshToken: r.refreshToken!, idToken: r.idToken);
  }

  @override
  Future<OidcTokens?> refresh(String refreshToken) async {
    try {
      final r = await _appAuth.token(TokenRequest(
        oidcClientId,
        oidcRedirectUri,
        issuer: oidcIssuer,
        refreshToken: refreshToken,
        allowInsecureConnections: oidcIssuer.startsWith('http://'),
      ));
      return OidcTokens(accessToken: r.accessToken!, refreshToken: r.refreshToken ?? refreshToken, idToken: r.idToken);
    } on FlutterAppAuthPlatformException {
      return null; // invalid_grant: the session ended
    }
  }

  @override
  Future<void> endSession(String? idToken) async {
    if (idToken == null) return;
    try {
      await _appAuth.endSession(EndSessionRequest(
        idTokenHint: idToken,
        issuer: oidcIssuer,
        postLogoutRedirectUrl: oidcRedirectUri,
        allowInsecureConnections: oidcIssuer.startsWith('http://'),
      ));
    } on FlutterAppAuthPlatformException {
      // Already gone; the local sign-out below is what matters to this device.
    }
  }
}

/// Where the refresh token survives an app restart. Never the access token.
abstract class TokenStore {
  Future<String?> read();
  Future<void> write(String refreshToken);
  Future<void> clear();
}

class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'seip.refresh_token';

  @override
  Future<String?> read() => _storage.read(key: _key);
  @override
  Future<void> write(String refreshToken) => _storage.write(key: _key, value: refreshToken);
  @override
  Future<void> clear() => _storage.delete(key: _key);
}

class MemoryTokenStore implements TokenStore {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String refreshToken) async => value = refreshToken;
  @override
  Future<void> clear() async => value = null;
}
