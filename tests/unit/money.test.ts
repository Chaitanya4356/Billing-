import { describe, expect, it } from "vitest";
import { formatPaise, percentToBp, roundDiv, rupeesToPaise } from "@/lib/money";

describe("roundDiv", () => {
  it("rounds half up", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 2)).toBe(2);
    expect(roundDiv(1, 3)).toBe(0);
  });
});

describe("rupeesToPaise", () => {
  it.each([
    ["45", 4500],
    ["12.5", 1250],
    ["12.50", 1250],
    ["₹1,200", 120000],
    [" 7 ", 700],
    ["0.1", 10],
  ])("parses %j to %d", (input, expected) => {
    expect(rupeesToPaise(input)).toBe(expected);
  });

  it.each(["1.005", "", "abc", "-5", "1e3", "12."])("rejects %j", (input) => {
    expect(rupeesToPaise(input)).toBeNull();
  });
});

describe("percentToBp", () => {
  it.each([
    ["10", 1000],
    ["12.5", 1250],
    ["100", 10000],
  ])("parses %j to %d", (input, expected) => {
    expect(percentToBp(input)).toBe(expected);
  });

  it.each(["0", "100.01", "abc", ""])("rejects %j", (input) => {
    expect(percentToBp(input)).toBeNull();
  });
});

describe("formatPaise", () => {
  it("formats with Indian grouping", () => {
    expect(formatPaise(4500)).toBe("₹45.00");
    expect(formatPaise(12345600)).toBe("₹1,23,456.00");
    expect(formatPaise(5)).toBe("₹0.05");
  });
});
