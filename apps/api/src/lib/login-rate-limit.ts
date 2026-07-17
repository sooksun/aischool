// In-process login throttle (SEC-AUTH-5 / SEIP-OPS-004).
// Per-IP + per-account (email) fixed windows. Single-process MVP — multi-instance
// deployments should put the edge nginx limit_req in front (per-IP) and later
// share this counter via Redis if horizontal scale is required.
//
// Edge nginx is the first line of defense; this module is defense-in-depth so
// local/dev and misconfigured reverse proxies still throttle brute force.

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

  /** Test helper — wipe all counters. */
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

/** Process-wide default used by the API (tests may replace via setLoginRateLimiter). */
let defaultLimiter = new LoginRateLimiter();

export function getLoginRateLimiter(): LoginRateLimiter {
  return defaultLimiter;
}

export function setLoginRateLimiter(limiter: LoginRateLimiter): void {
  defaultLimiter = limiter;
}

/** Build from env-ish numbers; invalid values fall back to defaults. */
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
