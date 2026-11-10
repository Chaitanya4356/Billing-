import { describe, expect, it } from "vitest";
import { getEnv, parseEnv } from "@/lib/env";

const GOOD_URL = "postgres://user:secret@host:5432/db";

function message(raw: Record<string, string | undefined>): string {
  try {
    parseEnv(raw);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("throws and names DATABASE_URL when nothing is set", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("treats an empty DATABASE_URL as missing", () => {
    expect(message({ DATABASE_URL: "" })).toMatch(/DATABASE_URL: required/);
  });

  it("returns typed values for a valid postgres:// URL", () => {
    expect(parseEnv({ DATABASE_URL: GOOD_URL, NODE_ENV: "production" })).toEqual({
      DATABASE_URL: GOOD_URL,
      NODE_ENV: "production",
    });
  });

  it("accepts the postgresql:// scheme", () => {
    const url = "postgresql://u:p@db.example.com:5432/billing?sslmode=require";
    expect(parseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("rejects a wrong scheme without echoing the URL or its password", () => {
    const bad = "mysql://admin:hunter2@db.internal:3306/billing";
    const msg = message({ DATABASE_URL: bad });
    expect(msg).toMatch(/DATABASE_URL/);
    expect(msg).not.toContain(bad);
    expect(msg).not.toContain("hunter2");
    expect(msg).not.toContain("db.internal");
  });

  it("rejects a value that is not a URL without echoing it", () => {
    const msg = message({ DATABASE_URL: "not a url, password=hunter2" });
    expect(msg).toMatch(/DATABASE_URL/);
    expect(msg).not.toContain("hunter2");
  });

  it("defaults NODE_ENV to development", () => {
    expect(parseEnv({ DATABASE_URL: GOOD_URL }).NODE_ENV).toBe("development");
  });

  it.each(["development", "test", "production"] as const)("accepts NODE_ENV=%s", (value) => {
    expect(parseEnv({ DATABASE_URL: GOOD_URL, NODE_ENV: value }).NODE_ENV).toBe(value);
  });

  it("rejects NODE_ENV=staging and names it", () => {
    const msg = message({ DATABASE_URL: GOOD_URL, NODE_ENV: "staging" });
    expect(msg).toMatch(/NODE_ENV/);
    expect(msg).not.toMatch(/DATABASE_URL/);
  });

  it("reports every problem together in one error", () => {
    const msg = message({ DATABASE_URL: "mysql://x:y@z/db", NODE_ENV: "staging" });
    expect(msg).toMatch(/DATABASE_URL/);
    expect(msg).toMatch(/NODE_ENV/);
    expect(msg.match(/DATABASE_URL/g)).toHaveLength(1);
  });

  it("mentions .env.example so the fix is obvious", () => {
    expect(message({})).toMatch(/\.env\.example/);
  });
});

describe("getEnv", () => {
  it("parses process.env once and returns the same cached object", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = GOOD_URL;
    try {
      const first = getEnv();
      process.env.DATABASE_URL = "mysql://changed:later@h/db";
      const second = getEnv();
      expect(second).toBe(first);
      expect(second.DATABASE_URL).toBe(GOOD_URL);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});
