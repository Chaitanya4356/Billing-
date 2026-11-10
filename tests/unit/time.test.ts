import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDateFor,
  financialYearOf,
  formatBillNumber,
  formatDateTimeIST,
  monthRange,
  weekStartOf,
} from "@/lib/time";

describe("businessDateFor", () => {
  it.each([
    ["2026-11-09T18:29:59Z", 0, "2026-11-09"],
    ["2026-11-09T19:00:00Z", 0, "2026-11-10"],
    ["2026-11-09T20:30:00Z", 4, "2026-11-09"],
    ["2026-11-09T22:30:00Z", 4, "2026-11-10"],
  ])("%s with day start %d -> %s", (iso, hour, expected) => {
    expect(businessDateFor(new Date(iso), "Asia/Kolkata", hour)).toBe(expected);
  });
});

describe("financialYearOf", () => {
  it("rolls over on 1 April", () => {
    expect(financialYearOf("2027-03-31")).toBe("2026-27");
    expect(financialYearOf("2027-04-01")).toBe("2027-28");
  });
});

describe("formatBillNumber", () => {
  it("pads to six digits and never truncates", () => {
    expect(formatBillNumber("B", "2026-27", 123)).toBe("B-2627-000123");
    expect(formatBillNumber("B", "2026-27", 1234567)).toBe("B-2627-1234567");
  });
});

describe("date arithmetic", () => {
  it("finds the Monday of the week", () => {
    expect(weekStartOf("2026-11-10")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
  });

  it("gives month ranges including leap February", () => {
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("adds days across year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("formatDateTimeIST", () => {
  it("renders in Asia/Kolkata", () => {
    expect(formatDateTimeIST(new Date("2026-11-09T20:30:00Z"))).toBe("10 Nov 2026, 02:00 am");
  });
});
