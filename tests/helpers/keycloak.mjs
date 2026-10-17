/**
 * The dev Keycloak realm (infra/keycloak/seip-realm.dev.json) as a test fixture:
 * create a user linked to a SEIP account (`seip_uid`), then get a real access
 * token at LoA 1 (password) or LoA 2 (password + TOTP code) through the browser
 * flow, driven over plain HTTP — form posts and cookies — so no browser is needed.
 *
 * KEYCLOAK_ISSUER is the realm URL (http://localhost:8180/realms/seip). The
 * admin credentials and the seip-test client are dev-realm values.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

export const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER ?? '';
const BASE = KEYCLOAK_ISSUER.replace(/\/realms\/[^/]+\/?$/, '');
const REALM = KEYCLOAK_ISSUER.replace(/^.*\/realms\//, '').replace(/\/$/, '');
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'seip_kc_admin_dev_only';
const CLIENT_ID = 'seip-test';
const CLIENT_SECRET = 'seip-test-dev-secret-not-for-real-use'; // gitleaks:allow — dev realm test client
const REDIRECT = 'http://127.0.0.1:5999/callback';

const form = (o) => new URLSearchParams(o);

async function adminToken() {
  const res = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', body: form({ client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PASSWORD, grant_type: 'password' }),
  });
  if (!res.ok) throw new Error(`keycloak admin login ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

/** RFC 6238 code for Keycloak's stored secret (the raw string is the HMAC key). */
export function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counter).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

/**
 * A realm user linked to `seipUid`, with a password and a TOTP credential.
 * Returns what the token helpers need, plus `id` for deleteUser.
 */
export async function createUser(seipUid, { linked = true, email = `kc-${randomUUID()}@seip.local` } = {}) {
  const adm = await adminToken();
  const password = randomBytes(12).toString('base64url');
  const otpSecret = randomBytes(20).toString('hex');
  const res = await fetch(`${BASE}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adm}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username: email, email, emailVerified: true, enabled: true, firstName: 'K', lastName: 'C',
      attributes: linked ? { seip_uid: [seipUid] } : {},
      credentials: [
        { type: 'password', value: password, temporary: false },
        {
          type: 'otp', userLabel: 'test',
          secretData: JSON.stringify({ value: otpSecret }),
          credentialData: JSON.stringify({ subType: 'totp', digits: 6, period: 30, algorithm: 'HmacSHA1', counter: 0 }),
        },
      ],
    }),
  });
  if (res.status !== 201) throw new Error(`keycloak create user ${res.status}: ${await res.text()}`);
  const id = res.headers.get('location').split('/').pop();
  return { id, email, password, otpSecret };
}

export async function deleteUser(user) {
  const adm = await adminToken();
  await fetch(`${BASE}/admin/realms/${REALM}/users/${user.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${adm}` } });
}

/** LoA 1: the browser flow asking for acr "pwd" — the password form only. */
export const passwordToken = (user) => browserToken(user, 'pwd');

/** LoA 2: the browser flow asking for acr "mfa" — password, then the OTP form. */
export const mfaToken = (user) => browserToken(user, 'mfa');

/**
 * The authorization-code flow with PKCE, driven over HTTP: the login form, the
 * OTP form when the requested level needs it, then the code exchange. (A direct
 * grant is no shortcut: Keycloak answers it with acr "pwd" even when a TOTP code
 * is supplied, so it can never stand in for a step-up.)
 */
async function browserToken(user, acr) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const location = await signIn(`${KEYCLOAK_ISSUER}/protocol/openid-connect/auth?${form({
    client_id: CLIENT_ID, response_type: 'code', scope: 'openid', redirect_uri: REDIRECT,
    code_challenge: challenge, code_challenge_method: 'S256', acr_values: acr, state: randomUUID(),
  })}`, user);
  const code = new URL(location).searchParams.get('code');
  const tokenRes = await fetch(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    body: form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code_verifier: verifier }),
  });
  if (!tokenRes.ok) throw new Error(`keycloak code exchange ${tokenRes.status}: ${await tokenRes.text()}`);
  return (await tokenRes.json()).access_token;
}

/**
 * Given an authorization URL (any client — the API's webLogin redirect, say),
 * fill the login form, then the OTP form if the requested level asks for it, and
 * return the redirect Keycloak sends back to the client: its redirect_uri with
 * `code` and `state`. A fresh cookie jar each time, so nothing is reused from an
 * earlier SSO session.
 */
export async function signIn(authorizationUrl, user) {
  const jar = new Map();
  const keep = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const actionOf = (html) => {
    const m = html.match(/action="([^"]+)"/);
    if (!m) throw new Error(`keycloak: no form on page: ${html.slice(0, 200)}`);
    return m[1].replace(/&amp;/g, '&');
  };
  const post = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' }, body: form(body),
    });
    keep(res);
    return res;
  };

  const auth = await fetch(authorizationUrl, { redirect: 'manual' });
  keep(auth);
  let res = await post(actionOf(await auth.text()), { username: user.email, password: user.password });
  if (res.status === 200) {
    const otpPage = await res.text();
    res = await post(actionOf(otpPage), { otp: totp(user.otpSecret) });
    // Keycloak refuses a code already used in this 30 s window (replay
    // protection) — as when the same user stepped up a moment ago. Wait for the
    // next window and try once more.
    if (res.status === 200) {
      const retryPage = await res.text();
      await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
      res = await post(actionOf(retryPage), { otp: totp(user.otpSecret) });
    }
  }
  const location = res.headers.get('location');
  if (res.status !== 302 || !location) {
    throw new Error(`keycloak: login did not redirect back (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return location;
}

/** Realm users linked to `seipUid` (UserRepresentation, incl. requiredActions). */
export async function linkedUsers(seipUid) {
  const adm = await adminToken();
  const res = await fetch(`${BASE}/admin/realms/${REALM}/users?${form({ q: `seip_uid:${seipUid}`, exact: 'true' })}`, { headers: { authorization: `Bearer ${adm}` } });
  if (!res.ok) throw new Error(`keycloak user search ${res.status}`);
  return res.json();
}

/** Deletes every realm user linked to `seipUid` — for fixtures recreated each run. */
export async function deleteUsersLinkedTo(seipUid) {
  const adm = await adminToken();
  const res = await fetch(`${BASE}/admin/realms/${REALM}/users?${form({ q: `seip_uid:${seipUid}` })}`, { headers: { authorization: `Bearer ${adm}` } });
  if (!res.ok) throw new Error(`keycloak user search ${res.status}`);
  for (const u of await res.json()) await deleteUser(u);
}

/**
 * What the Flutter app does (ADR-0014 §5): public client seip-mobile, PKCE,
 * scope offline_access. Returns the token response (refresh token is Offline).
 */
export async function mobileSignIn(user, acr = 'pwd') {
  const redirect = 'th.go.seip.app:/oauth2redirect';
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const location = await signIn(`${KEYCLOAK_ISSUER}/protocol/openid-connect/auth?${form({
    client_id: 'seip-mobile', response_type: 'code', scope: 'openid offline_access', redirect_uri: redirect,
    code_challenge: challenge, code_challenge_method: 'S256', acr_values: acr, state: randomUUID(),
  })}`, user);
  const code = new URL(location.replace(/^th\.go\.seip\.app:/, 'https://app.invalid')).searchParams.get('code');
  const res = await fetch(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST', body: form({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: 'seip-mobile', code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`keycloak mobile code exchange ${res.status}: ${await res.text()}`);
  return res.json();
}

/** The app's refresh call. Null when Keycloak refuses (session gone). */
export async function mobileRefresh(refreshToken) {
  const res = await fetch(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST', body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'seip-mobile' }),
  });
  return res.ok ? res.json() : null;
}

/**
 * Revokes the user's offline (device) sessions for seip-mobile — what the P2
 * revokeDeviceSession must do. Measured 2026-10-13: logoutEverywhere() (the
 * admin "sign out" endpoint) does not reliably end them — a renewed offline
 * token survived it 4/4 times locally and was refused in CI.
 */
export async function revokeOfflineSessions(user) {
  const adm = await adminToken();
  const h = { authorization: `Bearer ${adm}` };
  const [client] = await (await fetch(`${BASE}/admin/realms/${REALM}/clients?${form({ clientId: 'seip-mobile' })}`, { headers: h })).json();
  const sessions = await (await fetch(`${BASE}/admin/realms/${REALM}/users/${user.id}/offline-sessions/${client.id}`, { headers: h })).json();
  for (const s of sessions) {
    const res = await fetch(`${BASE}/admin/realms/${REALM}/sessions/${s.id}?isOffline=true`, { method: 'DELETE', headers: h });
    if (!res.ok) throw new Error(`keycloak delete offline session ${res.status}`);
  }
  return sessions.length;
}

/** Ends every Keycloak session of the user (an admin's "sign out everywhere"). */
export async function logoutEverywhere(user) {
  const adm = await adminToken();
  const res = await fetch(`${BASE}/admin/realms/${REALM}/users/${user.id}/logout`, { method: 'POST', headers: { authorization: `Bearer ${adm}` } });
  if (!res.ok) throw new Error(`keycloak logout ${res.status}`);
}

export const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
