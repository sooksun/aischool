/**
 * Login throttle (SEC-AUTH-5 / SEIP-OPS-004) — process-global singleton (MVP).
 *
 * ## Defense layers
 * 1. **Primary (always):** edge nginx `limit_req` on `/api/v1/auth/login` (per-IP).
 *    See `infra/nginx/seip-staging.conf.example`. Fleet-wide even with N API replicas.
 * 2. **Defense-in-depth:** this module — per-IP + per-email fixed windows inside
 *    *one* Node process so local/dev and a misconfigured reverse proxy still
 *    throttle brute force (AUTH-004).
 *
 * ## Multi-instance (accepted for MVP — not a launch blocker)
 * Counters live in process memory. Two API replicas do **not** share counts.
 * That is fine while the edge is the primary limiter. Shared Redis (or similar)
 * is a future enhancement only if we run many API instances *without* a trusted
 * edge — track in PROJECT_STATE “Sprint 2+ remaining”, not a SEC launch gate.
 *
 * ## Singleton
 * One limiter per process, stored on `globalThis` so duplicate module graphs
 * still share state. Boot calls `configureLoginRateLimiterFromEnv`. Tests may
 * replace or reset process state via the test helpers below (documented, intentional).
 */

export interface LoginRateLimitOptions {
  /** Sliding-ish fixed window length (ms). */
  windowMs: number;
  /** Max attempts per client IP within the window. */
  maxPerIp: number;
  /** Max attempts per normalized email within the window. */
  maxPerEmail: number;
}

export interface RateLimitDecision {
  ok: boolean;
  /** Seconds until the stricter of the two buckets resets (when !ok). */
  retryAfterSec?: number;
  /** Which bucket rejected (for logs / tests). */
  reason?: 'ip' | 'email';
}

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULTS: LoginRateLimitOptions = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxPerIp: 40,
  maxPerEmail: 12,
};

const GLOBAL_KEY = '__seipLoginRateLimiter' as const;

interface GlobalSlot {
  limiter: LoginRateLimiter;
}

function globalSlot(): GlobalSlot {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: GlobalSlot };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { limiter: new LoginRateLimiter() };
  }
  return g[GLOBAL_KEY];
}

export class LoginRateLimiter {
  private readonly opts: LoginRateLimitOptions;
  private readonly byIp = new Map<string, Bucket>();
  private readonly byEmail = new Map<string, Bucket>();

  constructor(opts: Partial<LoginRateLimitOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Call at the start of every login attempt (success or fail still counts). */
  check(ip: string, email: string, now = Date.now()): RateLimitDecision {
    const ipKey = ip.trim() || 'unknown';
    const emailKey = email.trim().toLowerCase();

    const ipHit = this.hit(this.byIp, ipKey, this.opts.maxPerIp, now);
    if (!ipHit.ok) {
      return { ok: false, retryAfterSec: ipHit.retryAfterSec, reason: 'ip' };
    }
    const emailHit = this.hit(this.byEmail, emailKey, this.opts.maxPerEmail, now);
    if (!emailHit.ok) {
      return { ok: false, retryAfterSec: emailHit.retryAfterSec, reason: 'email' };
    }
    return { ok: true };
  }

  /** Wipe counters on this instance (tests / rare ops). */
  reset(): void {
    this.byIp.clear();
    this.byEmail.clear();
  }

  private hit(
    map: Map<string, Bucket>,
    key: string,
    max: number,
    now: number,
  ): RateLimitDecision {
    let b = map.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + this.opts.windowMs };
      map.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      return { ok: false, retryAfterSec };
    }
    return { ok: true };
  }
}

/** Process-wide limiter used by auth routes. */
export function getLoginRateLimiter(): LoginRateLimiter {
  return globalSlot().limiter;
}

/**
 * Replace the process-global instance (boot + tests).
 * Prefer `configureLoginRateLimiterFromEnv` at server start and
 * `installLoginRateLimiterForTests` in tests so restore is explicit.
 */
export function setLoginRateLimiter(limiter: LoginRateLimiter): void {
  globalSlot().limiter = limiter;
}

/** Boot: install env-derived limits as the process singleton. */
export function configureLoginRateLimiterFromEnv(env: {
  LOGIN_RATE_WINDOW_MS?: string;
  LOGIN_RATE_MAX_PER_IP?: string;
  LOGIN_RATE_MAX_PER_EMAIL?: string;
} = process.env): LoginRateLimiter {
  const limiter = loginRateLimiterFromEnv(env);
  setLoginRateLimiter(limiter);
  return limiter;
}

/**
 * Test helper — swap the process singleton and return a restore function.
 * Mutates process-global state by design (same graph as production routes).
 */
export function installLoginRateLimiterForTests(limiter: LoginRateLimiter): () => void {
  const previous = getLoginRateLimiter();
  setLoginRateLimiter(limiter);
  return () => setLoginRateLimiter(previous);
}

/** Test helper — clear counters on the *current* singleton without replacing it. */
export function resetLoginRateLimiterState(): void {
  getLoginRateLimiter().reset();
}

/** Build a limiter from env-ish numbers; invalid values fall back to defaults. */
export function loginRateLimiterFromEnv(env: {
  LOGIN_RATE_WINDOW_MS?: string;
  LOGIN_RATE_MAX_PER_IP?: string;
  LOGIN_RATE_MAX_PER_EMAIL?: string;
}): LoginRateLimiter {
  const windowMs = Number(env.LOGIN_RATE_WINDOW_MS) || DEFAULTS.windowMs;
  const maxPerIp = Number(env.LOGIN_RATE_MAX_PER_IP) || DEFAULTS.maxPerIp;
  const maxPerEmail = Number(env.LOGIN_RATE_MAX_PER_EMAIL) || DEFAULTS.maxPerEmail;
  return new LoginRateLimiter({ windowMs, maxPerIp, maxPerEmail });
}
