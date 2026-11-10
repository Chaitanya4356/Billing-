import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { ZodType } from "zod";
import { db } from "@/db/client";
import type { DbOrTx } from "@/db/client";
import { bills, payments, shopSettings, shops } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { escapeLike } from "@/lib/like";
import { businessDateFor } from "@/lib/time";
import type { AuthContext } from "@/lib/types";
import { recordAudit } from "@/modules/audit/service";
import { assertRole } from "@/modules/auth/guards";
import { isUuid } from "@/modules/catalog/schema";
import { getBillDetail } from "./repo";
import { billQuerySchema, cancelReasonSchema } from "./schema";
import type { BillQuery } from "./schema";
import type { BillDetail } from "./types";

export type { BillQuery } from "./schema";

export interface BillListRow {
  id: string;
  billNumberDisplay: string;
  tokenNumber: number;
  businessDate: string;
  createdAt: Date;
  status: "COMPLETED" | "CANCELLED";
  totalPaise: number;
  paymentMethod: "CASH" | "UPI";
}

const MAX_INT4 = 2_147_483_647;

function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new AppError("VALIDATION", r.error.issues[0]?.message ?? "Invalid input", r.error.issues);
  }
  return r.data;
}

interface ShopClock {
  timezone: string;
  dayStartHour: number;
  cashierCanCancel: boolean;
}

async function loadClock(executor: DbOrTx, shopId: string): Promise<ShopClock> {
  const [row] = await executor
    .select({
      timezone: shops.timezone,
      dayStartHour: shopSettings.dayStartHour,
      cashierCanCancel: shopSettings.cashierCanCancel,
    })
    .from(shops)
    .innerJoin(shopSettings, eq(shopSettings.shopId, shops.id))
    .where(eq(shops.id, shopId));
  if (!row) throw new AppError("NOT_FOUND", "Shop settings not found");
  return row;
}

const todayOf = (clock: ShopClock, now: Date): string =>
  businessDateFor(now, clock.timezone, clock.dayStartHour);

/**
 * Bill history, newest first. A cashier only ever sees today's business date
 * (any date filter they pass is ignored); an owner can filter by date or range.
 * A search of only digits is an exact token (within the date filter) or bill
 * number match; anything else is a case-insensitive substring match on the
 * displayed bill number.
 */
export async function listBills(
  ctx: AuthContext,
  query: BillQuery,
  now: Date = new Date(),
): Promise<{ rows: BillListRow[]; total: number }> {
  assertRole(ctx, ["OWNER", "CASHIER"]);
  const q = parseOrThrow(billQuerySchema, query);

  const conditions: SQL[] = [eq(bills.shopId, ctx.shopId)];
  if (ctx.role === "CASHIER") {
    conditions.push(eq(bills.businessDate, todayOf(await loadClock(db, ctx.shopId), now)));
  } else {
    const from = q.date ?? q.from;
    const to = q.date ?? q.to;
    if (from) conditions.push(gte(bills.businessDate, from));
    if (to) conditions.push(lte(bills.businessDate, to));
  }
  if (q.status) conditions.push(eq(bills.status, q.status));
  if (q.method) conditions.push(eq(payments.method, q.method));

  const term = q.search?.trim();
  if (term) {
    if (/^\d+$/.test(term)) {
      const n = Number(term);
      // Beyond int4 nothing can match (and comparing would be a database error).
      conditions.push(n > MAX_INT4 ? sql`false` : or(eq(bills.tokenNumber, n), eq(bills.billNumber, n))!);
    } else {
      conditions.push(ilike(bills.billNumberDisplay, `%${escapeLike(term)}%`));
    }
  }
  const where = and(...conditions);
  const join = and(eq(payments.billId, bills.id), eq(payments.shopId, bills.shopId));

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: bills.id,
        billNumberDisplay: bills.billNumberDisplay,
        tokenNumber: bills.tokenNumber,
        businessDate: bills.businessDate,
        createdAt: bills.createdAt,
        status: bills.status,
        totalPaise: bills.totalPaise,
        paymentMethod: payments.method,
      })
      .from(bills)
      .innerJoin(payments, join)
      .where(where)
      .orderBy(desc(bills.createdAt), desc(bills.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(bills)
      .innerJoin(payments, join)
      .where(where),
  ]);
  return { rows, total: count.total };
}

/** One bill with items and payment. A cashier can only read today's business date; anything else is NOT_FOUND. */
export async function getBill(ctx: AuthContext, billId: string, now: Date = new Date()): Promise<BillDetail> {
  assertRole(ctx, ["OWNER", "CASHIER"]);
  const bill = await getBillDetail(db, ctx.shopId, billId);
  if (!bill) throw new AppError("NOT_FOUND", "Bill not found");
  if (ctx.role === "CASHIER" && bill.businessDate !== todayOf(await loadClock(db, ctx.shopId), now)) {
    throw new AppError("NOT_FOUND", "Bill not found");
  }
  return bill;
}

/**
 * Cancels a bill (the bill and its numbers stay; only status changes). One
 * transaction on the locked bill row, so concurrent cancels yield exactly one
 * success. Owner: always. Cashier: only when the shop allows it (FORBIDDEN
 * otherwise) and only for today's business date (CANCEL_NOT_ALLOWED).
 * Never touches number_sequences: cancelled numbers are never reused.
 */
export async function cancelBill(
  ctx: AuthContext,
  billId: string,
  reason: string,
  now: Date = new Date(),
): Promise<BillDetail> {
  assertRole(ctx, ["OWNER", "CASHIER"]);
  return db.transaction(async (tx) => {
    const clock = await loadClock(tx, ctx.shopId);
    if (ctx.role === "CASHIER" && !clock.cashierCanCancel) {
      throw new AppError("FORBIDDEN", "Only the owner can cancel bills");
    }
    const why = parseOrThrow(cancelReasonSchema, reason);
    if (!isUuid(billId)) throw new AppError("NOT_FOUND", "Bill not found");

    const [bill] = await tx
      .select({ status: bills.status, businessDate: bills.businessDate })
      .from(bills)
      .where(and(eq(bills.id, billId), eq(bills.shopId, ctx.shopId)))
      .for("update");
    if (!bill) throw new AppError("NOT_FOUND", "Bill not found");
    if (ctx.role === "CASHIER" && bill.businessDate !== todayOf(clock, now)) {
      throw new AppError("CANCEL_NOT_ALLOWED", "Only today's bills can be cancelled. Ask the owner.");
    }
    if (bill.status === "CANCELLED") throw new AppError("ALREADY_CANCELLED", "This bill is already cancelled");

    await tx
      .update(bills)
      .set({ status: "CANCELLED", cancelledBy: ctx.userId, cancelledAt: now, cancelReason: why })
      .where(and(eq(bills.id, billId), eq(bills.shopId, ctx.shopId)));
    await tx
      .update(payments)
      .set({ status: "VOIDED" })
      .where(and(eq(payments.billId, billId), eq(payments.shopId, ctx.shopId)));
    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: "BILL_CANCELLED",
      entityType: "bill",
      entityId: billId,
      meta: { reason: why },
    });

    const detail = await getBillDetail(tx, ctx.shopId, billId);
    if (!detail) throw new Error("cancelled bill could not be read back");
    return detail;
  });
}

/**
 * Counts one print of a bill (also a cancelled one) and audits it:
 * BILL_PRINTED for the first, BILL_REPRINTED afterwards. The increment is one
 * atomic UPDATE, so concurrent prints get distinct counts and exactly one is
 * the first. A cashier can only print today's business date (the date is part
 * of the UPDATE's condition); anything else is NOT_FOUND.
 */
export async function recordPrint(
  ctx: AuthContext,
  billId: string,
  now: Date = new Date(),
): Promise<{ isReprint: boolean; printCount: number }> {
  assertRole(ctx, ["OWNER", "CASHIER"]);
  if (!isUuid(billId)) throw new AppError("NOT_FOUND", "Bill not found");
  return db.transaction(async (tx) => {
    const conditions: SQL[] = [eq(bills.id, billId), eq(bills.shopId, ctx.shopId)];
    if (ctx.role === "CASHIER") {
      conditions.push(eq(bills.businessDate, todayOf(await loadClock(tx, ctx.shopId), now)));
    }
    const [row] = await tx
      .update(bills)
      .set({ printCount: sql`${bills.printCount} + 1`, lastPrintedAt: now })
      .where(and(...conditions))
      .returning({ printCount: bills.printCount });
    if (!row) throw new AppError("NOT_FOUND", "Bill not found");

    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: row.printCount === 1 ? "BILL_PRINTED" : "BILL_REPRINTED",
      entityType: "bill",
      entityId: billId,
      meta: { printCount: row.printCount },
    });
    return { isReprint: row.printCount > 1, printCount: row.printCount };
  });
}
