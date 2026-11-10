import { describe, expect, it } from "vitest";
import {
  LOGIN_RATE_LIMIT,
  clientKeyFromHeaders,
  createRateLimiter,
  isLoginRateLimitEnabled,
} from "@/modules/auth/rate-limit";

const T0 = 1_000_000;

describe("createRateLimiter", () => {
  it("allows up to the limit, then blocks with the time left in the window", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(rl.attempt("a", T0)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(rl.attempt("a", T0 + 1_000)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(rl.attempt("a", T0 + 2_000)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(rl.attempt("a", T0 + 10_000)).toEqual({ allowed: false, retryAfterMs: 50_000 });
    expect(rl.attempt("a", T0 + 59_999)).toEqual({ allowed: false, retryAfterMs: 1 });
  });

  it("resets when the window expires", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000 });
    rl.attempt("a", T0);
    rl.attempt("a", T0);
    expect(rl.attempt("a", T0 + 1).allowed).toBe(false);
    expect(rl.attempt("a", T0 + 60_000)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(rl.attempt("a", T0 + 60_001).allowed).toBe(true);
    expect(rl.attempt("a", T0 + 60_002).allowed).toBe(false);
  });

  it("keeps keys independent", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.attempt("a", T0).allowed).toBe(true);
    expect(rl.attempt("a", T0).allowed).toBe(false);
    expect(rl.attempt("b", T0).allowed).toBe(true);
    expect(rl.attempt("b", T0).allowed).toBe(false);
  });

  it("caps memory by evicting the oldest entries, without throwing", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
    rl.attempt("first", T0);
    expect(() => {
      for (let i = 0; i < 10_000; i++) rl.attempt(`k${i}`, T0 + i);
    }).not.toThrow();
    expect(rl.size()).toBeLessThanOrEqual(100);
    // The oldest key was evicted, so it starts a fresh window.
    expect(rl.attempt("first", T0 + 10_000).allowed).toBe(true);
    expect(rl.size()).toBeLessThanOrEqual(100);
  });

  it("drops expired entries when the key comes back", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 2 });
    rl.attempt("a", T0);
    rl.attempt("b", T0);
    expect(rl.attempt("a", T0 + 1_000).allowed).toBe(true);
    expect(rl.size()).toBe(2);
  });

  it("uses only the injected clock", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1_000 });
    // Far-future timestamps: if Date.now() were consulted these would behave differently.
    expect(rl.attempt("a", 9e15).allowed).toBe(true);
    expect(rl.attempt("a", 9e15 + 999).allowed).toBe(false);
    expect(rl.attempt("a", 9e15 + 1_000).allowed).toBe(true);
  });

  it("login defaults are 10 attempts per 5 minutes", () => {
    expect(LOGIN_RATE_LIMIT).toEqual({ limit: 10, windowMs: 300_000 });
    const rl = createRateLimiter(LOGIN_RATE_LIMIT);
    for (let i = 0; i < 10; i++) expect(rl.attempt("ip", T0 + i).allowed).toBe(true);
    const blocked = rl.attempt("ip", T0 + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(300_000 - 10);
  });
});

describe("clientKeyFromHeaders", () => {
  const from = (h: Record<string, string>) => clientKeyFromHeaders((name) => h[name]);

  it("takes the first X-Forwarded-For entry", () => {
    expect(from({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })).toBe("203.0.113.7");
    expect(from({ "x-forwarded-for": "2001:db8::1" })).toBe("2001:db8::1");
  });

  it("trims whitespace", () => {
    expect(from({ "x-forwarded-for": "   198.51.100.4  ,10.0.0.1" })).toBe("198.51.100.4");
  });

  it("ignores garbage characters and falls back", () => {
    expect(from({ "x-forwarded-for": "evil<script>", "x-real-ip": "192.0.2.1" })).toBe("192.0.2.1");
    expect(from({ "x-forwarded-for": "owner; drop table" })).toBe("unknown");
    expect(from({ "x-forwarded-for": "" , "x-real-ip": "192.0.2.9" })).toBe("192.0.2.9");
  });

  it("ignores over-long values", () => {
    const long = "1".repeat(65);
    expect(from({ "x-forwarded-for": long, "x-real-ip": "192.0.2.2" })).toBe("192.0.2.2");
    expect(from({ "x-forwarded-for": "1".repeat(64) })).toBe("1".repeat(64));
  });

  it("falls back to X-Real-IP, sanitized the same way", () => {
    expect(from({ "x-real-ip": " 192.0.2.3 " })).toBe("192.0.2.3");
    expect(from({ "x-real-ip": "not-an-ip" })).toBe("unknown");
  });

  it("returns 'unknown' without usable headers", () => {
    expect(from({})).toBe("unknown");
    expect(clientKeyFromHeaders(() => null)).toBe("unknown");
  });
});

describe("isLoginRateLimitEnabled", () => {
  it("is on in production", () => {
    expect(isLoginRateLimitEnabled({ NODE_ENV: "production" })).toBe(true);
  });
  it("is on with LOGIN_RATE_LIMIT_ENABLED=1 in any env", () => {
    expect(isLoginRateLimitEnabled({ NODE_ENV: "development", LOGIN_RATE_LIMIT_ENABLED: "1" })).toBe(true);
    expect(isLoginRateLimitEnabled({ NODE_ENV: "test", LOGIN_RATE_LIMIT_ENABLED: "1" })).toBe(true);
  });
  it("is off otherwise", () => {
    expect(isLoginRateLimitEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isLoginRateLimitEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isLoginRateLimitEnabled({})).toBe(false);
    expect(isLoginRateLimitEnabled({ NODE_ENV: "development", LOGIN_RATE_LIMIT_ENABLED: "true" })).toBe(false);
    expect(isLoginRateLimitEnabled({ NODE_ENV: "development", LOGIN_RATE_LIMIT_ENABLED: "0" })).toBe(false);
  });
});
