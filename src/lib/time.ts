const HOUR_MS = 3_600_000;

/** Business date (YYYY-MM-DD): the local date after shifting back by the shop's day-start hour. */
export function businessDateFor(now: Date, timezone: string, dayStartHour: number): string {
  const shifted = new Date(now.getTime() - dayStartHour * HOUR_MS);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Indian financial year (April to March), e.g. '2026-27'. */
export function financialYearOf(businessDate: string): string {
  const [y, m] = businessDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function formatBillNumber(prefix: string, fy: string, n: number): string {
  const yy = fy.slice(2, 4) + fy.slice(5, 7);
  return `${prefix}-${yy}-${String(n).padStart(6, "0")}`;
}

export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateString(d);
}

/** Monday of the week containing `date`. */
export function weekStartOf(date: string): string {
  const dow = parseDate(date).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. "10 Nov 2026, 02:00 am". Month names come from a fixed table so ICU versions cannot change them. */
export function formatDateTimeIST(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${MONTH_NAMES[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}
