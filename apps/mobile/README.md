# SEIP mobile (Flutter)

ADR-0016: Flutter 3.47.7 / Dart 3.13.5, Android minSdk 24, iOS 15+. The app talks
to the API **only** through the generated client in `clients/dart/seip_api`
(swagger_parser, from the OpenAPI contract) — never hand-written models.

## P0 skeleton (SEIP-P0-006)

Sign in → load the caller (`login`, `getCurrentUser`). Tokens live in memory only;
the Keycloak PKCE flow (ADR-0014) replaces this in P1. Capture, the encrypted
offline outbox and resumable uploads land in P2.

## Run

```sh
# once: generate the API client the app depends on
(cd ../../clients/dart/seip_api && dart pub get && tool/generate.sh)

flutter pub get
flutter analyze
flutter test

# against a local API (Android emulator reaches the host as 10.0.2.2)
flutter run --dart-define=SEIP_API_URL=http://10.0.2.2:3011/api/v1

# live check without a device — the same client against the real API
SEIP_API_URL=http://127.0.0.1:3011/api/v1 flutter test test/live_api_test.dart
```

Debug builds allow cleartext HTTP (for the dev API); release builds are HTTPS-only.
