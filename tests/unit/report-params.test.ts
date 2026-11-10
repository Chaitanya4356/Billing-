import { describe, expect, it } from "vitest";
import { isRealDate, parseReportParams } from "@/modules/reports/params";

describe("parseReportParams", () => {
  it("defaults to the day period with no date when nothing is given", () => {
    expect(parseReportParams(undefined, undefined)).toEqual({ period: "day", date: null, invalid: false });
    expect(parseReportParams("", "")).toEqual({ period: "day", date: null, invalid: false });
    expect(parseReportParams(null, null)).toEqual({ period: "day", date: null, invalid: false });
  });

  it("accepts each allowed period and a real date", () => {
    for (const p of ["day", "week", "month"] as const) {
      expect(parseReportParams(p, "2026-11-10")).toEqual({ period: p, date: "2026-11-10", invalid: false });
    }
  });

  it("rejects an unknown period but keeps a good date", () => {
    expect(parseReportParams("zzz", "2026-11-10")).toEqual({ period: "day", date: "2026-11-10", invalid: true });
    expect(parseReportParams("DAY", undefined).invalid).toBe(true);
    expect(parseReportParams("constructor", undefined).invalid).toBe(true);
    expect(parseReportParams("__proto__", undefined).invalid).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    for (const d of ["garbage", "2026-02-30", "2026-13-01", "2026-1-1", "20261110", "2026-11-10x", " 2026-11-10", "2026-11-10\n"]) {
      expect(parseReportParams("day", d)).toEqual({ period: "day", date: null, invalid: true });
    }
  });
});

describe("isRealDate", () => {
  it("knows leap days", () => {
    expect(isRealDate("2024-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
  });
});
