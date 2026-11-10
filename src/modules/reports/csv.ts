import type { SalesSummary } from "./service";

/** One bill in the export (cancelled bills included, with status CANCELLED). */
export interface CsvBillRow {
  businessDate: string;
  billNumberDisplay: string;
  tokenNumber: number;
  status: string;
  subtotalPaise: number;
  discountPaise: number;
  gstPaise: number;
  totalPaise: number;
  paymentMethod: string;
}

const EOL = "\r\n";
const HEADER = ["Date", "Bill No", "Token", "Status", "Subtotal", "Discount", "GST", "Total", "Payment Method"].join(",");

/**
 * Integer paise to a plain rupee string with two decimals ("4500" -> "45.00"),
 * by integer arithmetic only. No thousands separators, no currency symbol.
 */
function rupees(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error(`Amount is not a whole number of paise: ${paise}`);
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${paise < 0 ? "-" : ""}${whole}.${frac}`;
}

/** RFC 4180: quote a field that contains a comma, quote, CR or LF; double embedded quotes. */
function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/**
 * A free-text field. A spreadsheet treats a cell that starts with = + - @ (or a
 * tab / CR) as a formula, so such text gets a leading single quote. Only for
 * text; amounts and counts are numbers and are never prefixed.
 */
function text(value: string): string {
  return quote(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

/**
 * The report CSV: a header row, one row per bill, one blank line, then a
 * "Summary" section of `Label,Value` rows. CRLF line endings, amounts in
 * rupees with two decimals.
 */
export function buildReportCsv(rows: CsvBillRow[], summary: SalesSummary): string {
  const lines: string[] = [HEADER];
  for (const r of rows) {
    lines.push(
      [
        text(r.businessDate),
        text(r.billNumberDisplay),
        String(r.tokenNumber),
        text(r.status),
        rupees(r.subtotalPaise),
        rupees(r.discountPaise),
        rupees(r.gstPaise),
        rupees(r.totalPaise),
        text(r.paymentMethod),
      ].join(","),
    );
  }
  lines.push(
    "",
    "Summary",
    `Gross sales,${rupees(summary.grossSalesPaise)}`,
    `Discounts,${rupees(summary.discountPaise)}`,
    `GST,${rupees(summary.gstPaise)}`,
    `Net total,${rupees(summary.totalPaise)}`,
    `Bills,${summary.billCount}`,
    `Average bill,${rupees(summary.avgBillPaise)}`,
    `Cash,${rupees(summary.cashPaise)}`,
    `UPI,${rupees(summary.upiPaise)}`,
    `Cancelled bills,${summary.cancelledCount}`,
    `Cancelled amount,${rupees(summary.cancelledPaise)}`,
  );
  return lines.join(EOL) + EOL;
}
