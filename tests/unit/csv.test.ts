import { describe, expect, it } from "vitest";
import { buildReportCsv } from "@/modules/reports/csv";
import type { SalesSummary } from "@/modules/reports/service";

type Row = Parameters<typeof buildReportCsv>[0][number];

const SUMMARY: SalesSummary = {
  grossSalesPaise: 49500,
  discountPaise: 1850,
  gstPaise: 1158,
  totalPaise: 48808,
  billCount: 5,
  avgBillPaise: 9762,
  cashPaise: 30408,
  upiPaise: 18400,
  cancelledCount: 1,
  cancelledPaise: 6300,
};

const ZERO: SalesSummary = {
  grossSalesPaise: 0,
  discountPaise: 0,
  gstPaise: 0,
  totalPaise: 0,
  billCount: 0,
  avgBillPaise: 0,
  cashPaise: 0,
  upiPaise: 0,
  cancelledCount: 0,
  cancelledPaise: 0,
};

function row(over: Partial<Row> = {}): Row {
  return {
    businessDate: "2026-11-10",
    billNumberDisplay: "B-2627-000001",
    tokenNumber: 7,
    status: "COMPLETED",
    subtotalPaise: 4500,
    discountPaise: 0,
    gstPaise: 0,
    totalPaise: 4500,
    paymentMethod: "CASH",
    ...over,
  };
}

const HEADER = "Date,Bill No,Token,Status,Subtotal,Discount,GST,Total,Payment Method";

describe("buildReportCsv", () => {
  it("starts with the exact header row and uses CRLF line endings throughout", () => {
    const csv = buildReportCsv([row()], SUMMARY);
    expect(csv.startsWith(`${HEADER}\r\n`)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    // no bare LF or CR: every line break is a CRLF pair
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes one line per bill with amounts as rupees built from integer paise", () => {
    const csv = buildReportCsv(
      [
        row(),
        row({
          billNumberDisplay: "B-2627-000002",
          tokenNumber: 8,
          subtotalPaise: 123456,
          discountPaise: 5,
          gstPaise: 100,
          totalPaise: 123551,
          paymentMethod: "UPI",
        }),
      ],
      SUMMARY,
    );
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("2026-11-10,B-2627-000001,7,COMPLETED,45.00,0.00,0.00,45.00,CASH");
    expect(lines[2]).toBe("2026-11-10,B-2627-000002,8,COMPLETED,1234.56,0.05,1.00,1235.51,UPI");
  });

  it("formats 4500 as 45.00, 5 as 0.05, 123456 as 1234.56 and 0 as 0.00", () => {
    const csv = buildReportCsv([row({ subtotalPaise: 4500, discountPaise: 5, gstPaise: 123456, totalPaise: 0 })], ZERO);
    expect(csv.split("\r\n")[1]).toBe("2026-11-10,B-2627-000001,7,COMPLETED,45.00,0.05,1234.56,0.00,CASH");
  });

  it("includes cancelled bills with their status", () => {
    const csv = buildReportCsv(
      [row({ status: "CANCELLED", totalPaise: 6300, subtotalPaise: 6000, gstPaise: 300 })],
      SUMMARY,
    );
    expect(csv.split("\r\n")[1]).toBe("2026-11-10,B-2627-000001,7,CANCELLED,60.00,0.00,3.00,63.00,CASH");
  });

  it("quotes a field containing a comma, a quote or a newline and doubles embedded quotes (RFC 4180)", () => {
    const csv = buildReportCsv(
      [row({ billNumberDisplay: "B,1" }), row({ billNumberDisplay: 'B"2"' }), row({ billNumberDisplay: "B\n3" })],
      SUMMARY,
    );
    expect(csv).toContain('2026-11-10,"B,1",7,');
    expect(csv).toContain('2026-11-10,"B""2""",7,');
    expect(csv).toContain('2026-11-10,"B\n3",7,');
  });

  it("prefixes a text field starting with = + - or @ with a single quote, but never an amount", () => {
    const csv = buildReportCsv(
      [
        row({ billNumberDisplay: "=SUM(A1)" }),
        row({ billNumberDisplay: "+1" }),
        row({ billNumberDisplay: "-1" }),
        row({ billNumberDisplay: "@x" }),
        row({ billNumberDisplay: "=a,b" }),
      ],
      SUMMARY,
    );
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("2026-11-10,'=SUM(A1),7,COMPLETED,45.00,0.00,0.00,45.00,CASH");
    expect(lines[2].split(",")[1]).toBe("'+1");
    expect(lines[3].split(",")[1]).toBe("'-1");
    expect(lines[4].split(",")[1]).toBe("'@x");
    expect(lines[5]).toContain(`"'=a,b"`);
    // amounts are untouched
    expect(lines[1].split(",").slice(4, 8)).toEqual(["45.00", "0.00", "0.00", "45.00"]);
  });

  it("follows the bill rows with one blank line and then the summary section", () => {
    const csv = buildReportCsv([row(), row({ billNumberDisplay: "B-2627-000002" })], SUMMARY);
    expect(csv.split("\r\n")).toEqual([
      HEADER,
      "2026-11-10,B-2627-000001,7,COMPLETED,45.00,0.00,0.00,45.00,CASH",
      "2026-11-10,B-2627-000002,7,COMPLETED,45.00,0.00,0.00,45.00,CASH",
      "",
      "Summary",
      "Gross sales,495.00",
      "Discounts,18.50",
      "GST,11.58",
      "Net total,488.08",
      "Bills,5",
      "Average bill,97.62",
      "Cash,304.08",
      "UPI,184.00",
      "Cancelled bills,1",
      "Cancelled amount,63.00",
      "",
    ]);
  });

  it("an empty rows array still yields the header and the summary", () => {
    expect(buildReportCsv([], ZERO).split("\r\n")).toEqual([
      HEADER,
      "",
      "Summary",
      "Gross sales,0.00",
      "Discounts,0.00",
      "GST,0.00",
      "Net total,0.00",
      "Bills,0",
      "Average bill,0.00",
      "Cash,0.00",
      "UPI,0.00",
      "Cancelled bills,0",
      "Cancelled amount,0.00",
      "",
    ]);
  });

  it("handles amounts above int32 without floating point drift", () => {
    const csv = buildReportCsv([], { ...ZERO, totalPaise: 9_007_199_254_740_991 });
    expect(csv).toContain("Net total,90071992547409.91\r\n");
  });
});
