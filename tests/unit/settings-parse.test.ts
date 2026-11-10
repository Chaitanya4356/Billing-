import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "@/lib/money";
import {
  bpToPercentInput,
  paiseToRupeeInput,
  parseGstRateBp,
  parseZeroablePercentBp,
} from "@/modules/shop/form-parse";

describe("parseGstRateBp", () => {
  it.each([
    ["0", 0],
    ["0.0", 0],
    ["0.00", 0],
    [" 0 ", 0],
    ["5", 500],
    ["12.5", 1250],
    ["18", 1800],
    ["28", 2800],
    ["100", 10000],
  ])("parses %j to %d", (input, expected) => {
    expect(parseGstRateBp(input)).toBe(expected);
  });

  it.each([[""], ["  "], ["abc"], ["-1"], ["100.01"], ["101"], ["1.234"], ["5%"]])("rejects %j", (input) => {
    expect(parseGstRateBp(input)).toBeNull();
  });
});

describe("parseZeroablePercentBp", () => {
  it("allows 0 (cashier may not discount) and delegates the rest", () => {
    expect(parseZeroablePercentBp("0")).toBe(0);
    expect(parseZeroablePercentBp("10")).toBe(1000);
    expect(parseZeroablePercentBp("")).toBeNull();
    expect(parseZeroablePercentBp("100.5")).toBeNull();
  });
});

describe("paiseToRupeeInput / bpToPercentInput", () => {
  it.each([
    [0, "0"],
    [5000, "50"],
    [1250, "12.5"],
    [1205, "12.05"],
    [5, "0.05"],
    [10, "0.1"],
  ])("formats %d as %j and round-trips", (value, text) => {
    expect(paiseToRupeeInput(value)).toBe(text);
    expect(bpToPercentInput(value)).toBe(text);
    expect(rupeesToPaise(text)).toBe(value);
  });
});
