import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { billItems, bills, payments, shopSettings, shops } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { roundDiv } from "@/lib/money";
import { addDays, businessDateFor, monthRange, weekStartOf } from "@/lib/time";
import type { AuthContext } from "@/lib/types";
import { assertRole } from "@/modules/auth/guards";
import { listBills } from "@/modules/bills/service";
import type { BillListRow } from "@/modules/bills/service";
import type { CsvBillRow } from "./csv";

/*
 * Reports (owner only).
 *
 * Inclusion rules, applied by every function here:
 *  - Sales figures (gross, discount, GST, total, count, average, cash, UPI,
 *    daily rows, top items) count only bills with status COMPLETED.
 *  - The cash/UPI split counts only payments with status RECORDED belonging to
 *    those completed bills (cancelling a bill voids its payment).
 *  - Cancelled bills are reported separately (cancelledCount, cancelledPaise =
 *    sum of total_paise) and are attributed to the bill's own business_date,
 *    NOT to the day it was cancelled.
 *  - Every query is scoped by ctx.shopId and filtered by business_date, the
 *    shop's own business day, so a 23:30 bill belongs to its own date and an
 *    early-morning bill before the day-start hour to the previous date.
 *  - Money stays in integer paise. Sums are cast to bigint in SQL and read as
 *    text, so no aggregate can wrap at int4 and no float rounding occurs.
 */

export interface DateRange {
  /** Inclusive business date, YYYY-MM-DD. */
  from: string;
  /** Inclusive business date, YYYY-MM-DD. */
  to: string;
}

export interface SalesSummary {
  /** Sum of subtotals, before discount. */
  grossSalesPaise: number;
  discountPaise: number;
  /** GST collected (bills.tax_paise), whether prices were inclusive or exclusive. */
  gstPaise: number;
  /** What customers paid: sum of totals. */
  totalPaise: number;
  billCount: number;
  /** totalPaise / billCount rounded half up; 0 with no bills. */
  avgBillPaise: number;
  cashPaise: number;
  upiPaise: number;
  cancelledCount: number;
  cancelledPaise: number;
}

export interface DailyRow {
  businessDate: string;
  billCount: number;
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  discountPaise: number;
  gstPaise: number;
}

export interface TopItem {
  productName: string;
  quantity: number;
  amountPaise: number;
}

const MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 86_400_000;
const DEFAULT_TOP_LIMIT = 10;
const MAX_TOP_LIMIT = 50;

function invalid(message: string): never {
  throw new AppError("VALIDATION", message);
}

/** Epoch ms (UTC midnight) of a real calendar date written YYYY-MM-DD, or null. */
function dateMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}

function assertDate(value: unknown, label: string): string {
  if (dateMs(value) === null) invalid(`${label} must be a valid date (YYYY-MM-DD)`);
  return value as string;
}

function validateRange(range: DateRange): DateRange {
  const from = assertDate(range?.from, "From date");
  const to = assertDate(range?.to, "To date");
  const days = (dateMs(to)! - dateMs(from)!) / MS_PER_DAY + 1;
  if (days < 1) invalid("From date must not be after to date");
  if (days > MAX_RANGE_DAYS) invalid(`Date range is at most ${MAX_RANGE_DAYS} days`);
  return { from, to };
}

/** The business-date range of a day, Monday-to-Sunday week or calendar month around `anchor`. */
export function rangeForPeriod(period: "day" | "week" | "month", anchor: string): DateRange {
  assertDate(anchor, "Date");
  switch (period) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const from = weekStartOf(anchor);
      return { from, to: addDays(from, 6) };
    }
    case "month":
      return monthRange(anchor);
    default:
      return invalid("Period must be day, week or month");
  }
}

/** Reads a SQL aggregate returned as text (or null) as an exact JS integer. */
function int(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error(`Report aggregate is not a safe integer: ${value}`);
  return n;
}

const sumOf = (col: Parameters<typeof sql>[1]) => sql<string>`coalesce(sum(${col}), 0)::bigint::text`;
const countAll = sql<string>`count(*)::bigint::text`;

const inRange = (shopId: string, range: DateRange) =>
  and(eq(bills.shopId, shopId), gte(bills.businessDate, range.from), lte(bills.businessDate, range.to));

/** Recorded payments of completed bills in range, by business date and method. */
function paymentTotals(shopId: string, range: DateRange) {
  return db
    .select({
      businessDate: bills.businessDate,
      method: payments.method,
      amount: sumOf(payments.amountPaise),
    })
    .from(payments)
    .innerJoin(bills, and(eq(bills.id, payments.billId), eq(bills.shopId, payments.shopId)))
    .where(and(inRange(shopId, range), eq(bills.status, "COMPLETED"), eq(payments.status, "RECORDED")))
    .groupBy(bills.businessDate, payments.method);
}

async function summarize(shopId: string, range: DateRange): Promise<SalesSummary> {
  const [byStatus, byMethod] = await Promise.all([
    db
      .select({
        status: bills.status,
        n: countAll,
        gross: sumOf(bills.subtotalPaise),
        discount: sumOf(bills.discountPaise),
        gst: sumOf(bills.taxPaise),
        total: sumOf(bills.totalPaise),
      })
      .from(bills)
      .where(inRange(shopId, range))
      .groupBy(bills.status),
    paymentTotals(shopId, range),
  ]);

  const done = byStatus.find((r) => r.status === "COMPLETED");
  const cancelled = byStatus.find((r) => r.status === "CANCELLED");
  const billCount = int(done?.n);
  const totalPaise = int(done?.total);
  const methodTotal = (method: "CASH" | "UPI") =>
    byMethod.filter((r) => r.method === method).reduce((sum, r) => sum + int(r.amount), 0);

  return {
    grossSalesPaise: int(done?.gross),
    discountPaise: int(done?.discount),
    gstPaise: int(done?.gst),
    totalPaise,
    billCount,
    avgBillPaise: billCount === 0 ? 0 : roundDiv(totalPaise, billCount),
    cashPaise: methodTotal("CASH"),
    upiPaise: methodTotal("UPI"),
    cancelledCount: int(cancelled?.n),
    cancelledPaise: int(cancelled?.total),
  };
}

/** Totals for completed bills in the range, plus the cancelled count and amount. */
export async function getSalesSummary(ctx: AuthContext, range: DateRange): Promise<SalesSummary> {
  assertRole(ctx, ["OWNER"]);
  return summarize(ctx.shopId, validateRange(range));
}

/** One row per business date that has at least one completed bill, ascending. */
export async function getDailyBreakdown(ctx: AuthContext, range: DateRange): Promise<DailyRow[]> {
  assertRole(ctx, ["OWNER"]);
  const r = validateRange(range);
  const [days, byMethod] = await Promise.all([
    db
      .select({
        businessDate: bills.businessDate,
        n: countAll,
        total: sumOf(bills.totalPaise),
        discount: sumOf(bills.discountPaise),
        gst: sumOf(bills.taxPaise),
      })
      .from(bills)
      .where(and(inRange(ctx.shopId, r), eq(bills.status, "COMPLETED")))
      .groupBy(bills.businessDate)
      .orderBy(asc(bills.businessDate)),
    paymentTotals(ctx.shopId, r),
  ]);

  return days.map((d) => {
    const methodTotal = (method: "CASH" | "UPI") =>
      byMethod
        .filter((p) => p.businessDate === d.businessDate && p.method === method)
        .reduce((sum, p) => sum + int(p.amount), 0);
    return {
      businessDate: d.businessDate,
      billCount: int(d.n),
      totalPaise: int(d.total),
      cashPaise: methodTotal("CASH"),
      upiPaise: methodTotal("UPI"),
      discountPaise: int(d.discount),
      gstPaise: int(d.gst),
    };
  });
}

/**
 * Best sellers by amount (then name), from completed bills. Grouped by the
 * product name printed on the bill, so a later rename keeps its history.
 * `limit` defaults to 10 and is clamped to 1..50.
 */
export async function getTopItems(
  ctx: AuthContext,
  range: DateRange,
  limit: number = DEFAULT_TOP_LIMIT,
): Promise<TopItem[]> {
  assertRole(ctx, ["OWNER"]);
  const r = validateRange(range);
  const n = Number.isFinite(limit) ? Math.min(MAX_TOP_LIMIT, Math.max(1, Math.trunc(limit))) : DEFAULT_TOP_LIMIT;
  const amount = sumOf(billItems.lineTotalPaise);

  const rows = await db
    .select({
      productName: billItems.productName,
      quantity: sumOf(billItems.quantity),
      amount,
    })
    .from(billItems)
    .innerJoin(bills, and(eq(bills.id, billItems.billId), eq(bills.shopId, billItems.shopId)))
    .where(and(inRange(ctx.shopId, r), eq(bills.status, "COMPLETED")))
    .groupBy(billItems.productName)
    .orderBy(desc(sql`sum(${billItems.lineTotalPaise})`), asc(billItems.productName))
    .limit(n);
  return rows.map((row) => ({
    productName: row.productName,
    quantity: int(row.quantity),
    amountPaise: int(row.amount),
  }));
}

/** Today's summary (the shop's current business day) and the 10 newest bills overall. */
export async function getDashboard(
  ctx: AuthContext,
  now: Date = new Date(),
): Promise<{ today: SalesSummary; recent: BillListRow[] }> {
  assertRole(ctx, ["OWNER"]);
  const [clock] = await db
    .select({ timezone: shops.timezone, dayStartHour: shopSettings.dayStartHour })
    .from(shops)
    .innerJoin(shopSettings, eq(shopSettings.shopId, shops.id))
    .where(eq(shops.id, ctx.shopId));
  if (!clock) throw new AppError("NOT_FOUND", "Shop settings not found");

  const today = businessDateFor(now, clock.timezone, clock.dayStartHour);
  const [summary, recent] = await Promise.all([
    summarize(ctx.shopId, { from: today, to: today }),
    listBills(ctx, { pageSize: 10, page: 1 }, now),
  ]);
  return { today: summary, recent: recent.rows };
}

/**
 * Every bill in the range for the CSV export, cancelled ones included (status
 * CANCELLED), by business date then bill number.
 */
export async function getBillsForCsv(ctx: AuthContext, range: DateRange): Promise<CsvBillRow[]> {
  assertRole(ctx, ["OWNER"]);
  const r = validateRange(range);
  return db
    .select({
      businessDate: bills.businessDate,
      billNumberDisplay: bills.billNumberDisplay,
      tokenNumber: bills.tokenNumber,
      status: bills.status,
      subtotalPaise: bills.subtotalPaise,
      discountPaise: bills.discountPaise,
      gstPaise: bills.taxPaise,
      totalPaise: bills.totalPaise,
      paymentMethod: payments.method,
    })
    .from(bills)
    .innerJoin(payments, and(eq(payments.billId, bills.id), eq(payments.shopId, bills.shopId)))
    .where(inRange(ctx.shopId, r))
    .orderBy(asc(bills.businessDate), asc(bills.billNumber), asc(bills.id));
}
