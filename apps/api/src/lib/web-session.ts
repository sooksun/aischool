// Cookies and crypto for the web BFF session (CCR-018, ADR-0014 §4).
//
//   __Host-seip       the session: random 256-bit value, httpOnly. The DB keeps
//                     only its SHA-256, so a database read does not yield a
//                     usable cookie.
//   __Host-seip-csrf  double-submit token: readable by the page, echoed back as
//                     X-CSRF-Token on writes, and checked against the session's
//                     stored hash — so a cookie planted by another origin does
//                     not match.
//   __Host-seip-oidc  state, nonce, PKCE verifier and return path between
//                     webLogin and webCallback; HMAC-signed, 10 minutes.
//
// `__Host-` means Secure, Path=/ and no Domain: the browser refuses the cookie
// otherwise, and no subdomain can set or overwrite it. Browsers treat
// http://localhost and 127.0.0.1 as secure, so dev works over HTTP.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-seip';
export const CSRF_COOKIE = '__Host-seip-csrf';
export const OIDC_COOKIE = '__Host-seip-oidc';
/** How often a session re-checks the Keycloak session behind it (≤60 s revocation). */
export const KC_CHECK_EVERY_MS = 60 * 1000;
const OIDC_TTL_S = 600;

export const randomToken = () => randomBytes(32).toString('base64url');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

export function setCookie(name: string, value: string, opts: { maxAge: number; httpOnly: boolean; sameSite: 'Lax' | 'Strict' }): string {
  return `${name}=${value}; Path=/; Secure; SameSite=${opts.sameSite}; Max-Age=${opts.maxAge}${opts.httpOnly ? '; HttpOnly' : ''}`;
}

export const clearCookie = (name: string) => `${name}=; Path=/; Secure; SameSite=Lax; Max-Age=0`;

export function equalSecrets(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Separate keys for separate jobs, all derived from JWT_SECRET. */
function key(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'seip-web-session', purpose, 32));
}

/** AES-256-GCM for the Keycloak refresh token at rest: base64(iv | tag | ciphertext). */
export function sealRefreshToken(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret, 'kc-refresh-token'), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function openRefreshToken(secret: string, sealed: string): string {
  const raw = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(secret, 'kc-refresh-token'), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export interface OidcState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  acr: 'pwd' | 'mfa';
}

export function signOidcState(secret: string, s: OidcState, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + OIDC_TTL_S })).toString('base64url');
  const mac = createHmac('sha256', key(secret, 'oidc-state')).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function readOidcState(secret: string, cookie: string | undefined, now = Date.now()): OidcState | null {
  if (!cookie) return null;
  const [body, mac] = cookie.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', key(secret, 'oidc-state')).update(body).digest('base64url');
  if (!equalSecrets(mac, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OidcState & { exp: number };
    return s.exp * 1000 > now ? s : null;
  } catch {
    return null;
  }
}

export const OIDC_COOKIE_MAX_AGE = OIDC_TTL_S;

/**
 * Open-redirect guard: a same-site absolute path only. `//evil.example`,
 * `/\evil`, schemes and anything with a control character fall back to `/`.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\\]/.test(value)) return '/';
  return value;
}
