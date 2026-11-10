import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("normalizes separators and country code", () => {
    expect(normalizePhone(" +91 98765-43210 ")).toBe("+919876543210");
    expect(normalizePhone("9876543210")).toBe("+919876543210");
  });

  it("returns null for empty input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it.each(["12ab", "123"])("throws VALIDATION for %j", (input) => {
    try {
      normalizePhone(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("VALIDATION");
    }
  });
});
