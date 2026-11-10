export type ReportPeriod = "day" | "week" | "month";

export const REPORT_PERIODS: readonly ReportPeriod[] = ["day", "week", "month"];

export interface ReportParams {
  /** The requested period, or "day" when absent or not allowed. */
  period: ReportPeriod;
  /** The requested anchor date, or null when absent or not a real YYYY-MM-DD date. */
  date: string | null;
  /** True when a period or date was given but is not valid (a page falls back, an export refuses). */
  invalid: boolean;
}

/** True for a real calendar date written exactly YYYY-MM-DD. */
export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const back = new Date(Date.UTC(y, mo - 1, d));
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d;
}

/**
 * Reads the `period` and `date` query values strictly: the period must be one
 * of the allowed names and the date a real calendar date. Absent values are
 * fine (defaults apply) and are not "invalid".
 */
export function parseReportParams(period: string | null | undefined, date: string | null | undefined): ReportParams {
  const periodGiven = period !== null && period !== undefined && period !== "";
  const dateGiven = date !== null && date !== undefined && date !== "";
  const periodOk = !periodGiven || (REPORT_PERIODS as readonly string[]).includes(period);
  const dateOk = !dateGiven || isRealDate(date);
  return {
    period: periodGiven && periodOk ? (period as ReportPeriod) : "day",
    date: dateGiven && dateOk ? date : null,
    invalid: !periodOk || !dateOk,
  };
}
