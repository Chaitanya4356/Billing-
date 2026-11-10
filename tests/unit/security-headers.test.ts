import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/lib/security-headers";

function asMap(nodeEnv: string): Record<string, string> {
  return Object.fromEntries(securityHeaders(nodeEnv).map((h) => [h.key, h.value]));
}

describe("securityHeaders", () => {
  it("always sets nosniff, DENY framing and same-origin referrer policy", () => {
    for (const env of ["development", "test", "production"]) {
      const headers = asMap(env);
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Referrer-Policy"]).toBe("same-origin");
    }
  });

  it("sets HSTS only in production", () => {
    expect(asMap("production")["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(asMap("development")["Strict-Transport-Security"]).toBeUndefined();
    expect(asMap("test")["Strict-Transport-Security"]).toBeUndefined();
  });

  it("does not add a Content-Security-Policy", () => {
    expect(asMap("production")["Content-Security-Policy"]).toBeUndefined();
  });
});
