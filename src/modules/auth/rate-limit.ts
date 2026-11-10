// In-memory, per-process rate limiting for the login form. Pure and
// clock-injectable so it can be unit tested; no DB access.
//
// Limits: memory is bounded (at most `maxKeys` entries); counters live in this
// process only and reset on restart. With several app instances each keeps its
// own counters, so a host- or proxy-level limit is still recommended.

export interface RateLimitResult {
  allowed: boolean;
  /** 0 when allowed; otherwise milliseconds until the key's window resets. */
  retryAfterMs: number;
}

export interface RateLimiter {
  attempt(key: string, now?: number): RateLimitResult;
  /** Number of keys currently tracked (for tests). */
  size(): number;
}

export interface RateLimiterOptions {
  /** Attempts allowed per key per window. */
  limit: number;
  windowMs: number;
  /** Maximum number of keys kept in memory (default 10 000). */
  maxKeys?: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

/**
 * Fixed window per key: the first attempt opens a window of `windowMs`; up to
 * `limit` attempts are allowed in it, later ones are refused until it ends.
 * Every attempt counts (a success does not refund).
 *
 * The Map keeps insertion order, and an entry is (re)inserted when its window
 * opens, so the first entries are always the oldest windows: when the cap is
 * reached the oldest (usually already expired) entries are evicted first.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = Math.max(1, options.maxKeys ?? 10_000);
  const entries = new Map<string, Entry>();

  return {
    attempt(key: string, now: number = Date.now()): RateLimitResult {
      let entry = entries.get(key);
      if (entry && now >= entry.resetAt) {
        entries.delete(key);
        entry = undefined;
      }
      if (!entry) {
        while (entries.size >= maxKeys) {
          const oldest = entries.keys().next();
          if (oldest.done) break;
          entries.delete(oldest.value);
        }
        entries.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: limit >= 1, retryAfterMs: limit >= 1 ? 0 : windowMs };
      }
      if (entry.count < limit) {
        entry.count += 1;
        return { allowed: true, retryAfterMs: 0 };
      }
      return { allowed: false, retryAfterMs: Math.max(0, entry.resetAt - now) };
    },
    size: () => entries.size,
  };
}

const IP_CHARS = /^[0-9a-fA-F:.]+$/;

function sanitizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 64 || !IP_CHARS.test(v)) return null;
  return v;
}

/**
 * The rate-limit key for a request: the first `X-Forwarded-For` entry, else
 * `X-Real-IP`, else "unknown". Values that are empty, longer than 64 characters
 * or contain anything other than hex digits, ':' and '.' are ignored. Behind a
 * reverse proxy the proxy must set/overwrite `X-Forwarded-For`, otherwise a
 * client can choose its own key.
 */
export function clientKeyFromHeaders(get: (name: string) => string | null | undefined): string {
  const xff = get("x-forwarded-for");
  const first = xff ? xff.split(",")[0] : null;
  return sanitizeIp(first) ?? sanitizeIp(get("x-real-ip")) ?? "unknown";
}

/** On in production, or anywhere with LOGIN_RATE_LIMIT_ENABLED=1; off otherwise (dev, tests, e2e). */
export function isLoginRateLimitEnabled(env: { NODE_ENV?: string; LOGIN_RATE_LIMIT_ENABLED?: string }): boolean {
  return env.NODE_ENV === "production" || env.LOGIN_RATE_LIMIT_ENABLED === "1";
}

export const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 5 * 60 * 1000 } as const;

export const LOGIN_RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Please wait a few minutes and try again.";

/** The process-wide login limiter (10 attempts per 5 minutes per client key). */
export const loginRateLimiter: RateLimiter = createRateLimiter(LOGIN_RATE_LIMIT);
