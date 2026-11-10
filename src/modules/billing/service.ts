import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import type { Tx } from "@/db/client";
import { billItems, bills, categories, payments, products, shopSettings, shops } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { businessDateFor, financialYearOf, formatBillNumber } from "@/lib/time";
import type { AuthContext } from "@/lib/types";
import { recordAudit } from "@/modules/audit/service";
import { assertRole } from "@/modules/auth/guards";
import { getBillDetail } from "@/modules/bills/repo";
import type { BillDetail, GstSnapshot, ShopSnapshot } from "@/modules/bills/types";
import { calculateTotals } from "./calc";
import { createBillSchema } from "./schema";
import type { CreateBillInput, ParsedCreateBillInput } from "./schema";
import { billSequenceKey, nextSequenceValue, tokenSequenceKey } from "./sequences";

const IDEMPOTENCY_CONSTRAINT = "bills_shop_id_idempotency_key_unique";

/**
 * True only for a unique violation (SQLSTATE 23505) of the
 * (shop_id, idempotency_key) constraint, also when wrapped by drizzle. A
 * violation of the bill number or token constraints is a real error.
 */
function isIdempotencyConflict(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const { code, constraint } = cur as { code?: unknown; constraint?: unknown };
    if (code === "23505") return constraint === IDEMPOTENCY_CONSTRAINT;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

function parseInput(input: CreateBillInput): ParsedCreateBillInput {
  const r = createBillSchema.safeParse(input);
  if (!r.success) {
    throw new AppError("VALIDATION", r.error.issues[0]?.message ?? "Invalid bill", r.error.issues);
  }
  return r.data;
}

async function findBillIdByKey(executor: Tx | typeof db, shopId: string, key: string): Promise<string | null> {
  const [row] = await executor
    .select({ id: bills.id })
    .from(bills)
    .where(and(eq(bills.shopId, shopId), eq(bills.idempotencyKey, key)));
  return row?.id ?? null;
}

interface PricedLine {
  productId: string;
  productName: string;
  categoryName: string;
  unitPricePaise: number;
  quantity: number;
}

/** Current catalog rows for the cart, in cart order. Inactive, deleted or foreign products are rejected. */
async function loadLines(shopId: string, input: ParsedCreateBillInput): Promise<PricedLine[]> {
  const ids = input.items.map((i) => i.productId);
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      pricePaise: products.pricePaise,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.shopId, products.shopId)))
    .where(
      and(
        eq(products.shopId, shopId),
        inArray(products.id, ids),
        eq(products.isActive, true),
        isNull(products.deletedAt),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new AppError("INVALID_PRODUCT", "Some items are no longer available. Please review the cart.", {
      productIds: missing,
    });
  }

  const changed = input.items.flatMap((i) => {
    const p = byId.get(i.productId)!;
    return p.pricePaise === i.expectedUnitPricePaise
      ? []
      : [{ productId: p.id, name: p.name, expectedUnitPricePaise: i.expectedUnitPricePaise, currentUnitPricePaise: p.pricePaise }];
  });
  if (changed.length > 0) {
    throw new AppError(
      "PRICE_CHANGED",
      `Prices changed for ${changed.map((c) => c.name).join(", ")}. Please review the cart.`,
      { products: changed },
    );
  }

  return input.items.map((i) => {
    const p = byId.get(i.productId)!;
    return {
      productId: p.id,
      productName: p.name,
      categoryName: p.categoryName,
      unitPricePaise: p.pricePaise,
      quantity: i.quantity,
    };
  });
}

/**
 * Creates a bill. Both roles. Validation, price checks, discount limits, totals
 * and the payment check all happen before the transaction, so a rejected
 * charge consumes no numbers. The transaction: idempotency lookup, bill
 * counter, token counter, inserts and audit, commit. A replay of an already
 * used idempotency key (also a concurrent one) returns the existing bill.
 */
export async function createBill(ctx: AuthContext, rawInput: CreateBillInput, now: Date = new Date()): Promise<BillDetail> {
  assertRole(ctx, ["OWNER", "CASHIER"]);
  const input = parseInput(rawInput);

  // A replay needs no further checks (prices may have changed since).
  const existingId = await findBillIdByKey(db, ctx.shopId, input.idempotencyKey);
  if (existingId) {
    const existing = await getBillDetail(db, ctx.shopId, existingId);
    if (existing) return existing;
  }

  const [settings] = await db.select().from(shopSettings).where(eq(shopSettings.shopId, ctx.shopId));
  const [shop] = await db.select().from(shops).where(eq(shops.id, ctx.shopId));
  if (!settings || !shop) throw new AppError("NOT_FOUND", "Shop settings not found");

  const lines = await loadLines(ctx.shopId, input);

  const { discount } = input;
  if (discount && ctx.role === "CASHIER") {
    const limit = discount.type === "PERCENT" ? settings.cashierDiscountMaxPctBp : settings.cashierDiscountMaxFlatPaise;
    if (discount.value > limit) {
      throw new AppError("DISCOUNT_LIMIT", "This discount is above the cashier limit. Ask the owner to apply it.");
    }
  }

  const gst = { enabled: settings.gstEnabled, rateBp: settings.gstRateBp, inclusive: settings.gstInclusive };
  const totals = calculateTotals({ lines, discount, gst, roundToRupee: settings.roundToRupee });

  const { payment } = input;
  if (payment.method === "CASH" && payment.cashTenderedPaise < totals.totalPaise) {
    throw new AppError("INSUFFICIENT_CASH", "Cash tendered is less than the bill total");
  }

  const shopSnapshot: ShopSnapshot = { name: shop.name, address: shop.address, phone: shop.phone, gstin: shop.gstin };
  const gstSnapshot: GstSnapshot = { ...gst, title: settings.receiptTitle };

  try {
    return await db.transaction(async (tx) => {
      const replay = await findBillIdByKey(tx, ctx.shopId, input.idempotencyKey);
      if (replay) {
        const existing = await getBillDetail(tx, ctx.shopId, replay);
        if (existing) return existing;
      }

      // Numbering settings are read under a share lock so a concurrent
      // tokenResetMode change (which locks these rows FOR UPDATE, shops first,
      // then syncs the counters) serialises with this bill. Same lock order as
      // updateSettings: shops, then shop_settings.
      const [lockedShop] = await tx
        .select({ timezone: shops.timezone })
        .from(shops)
        .where(eq(shops.id, ctx.shopId))
        .for("key share");
      const [numbering] = await tx
        .select({
          tokenResetMode: shopSettings.tokenResetMode,
          dayStartHour: shopSettings.dayStartHour,
          billPrefix: shopSettings.billPrefix,
        })
        .from(shopSettings)
        .where(eq(shopSettings.shopId, ctx.shopId))
        .for("share");
      if (!lockedShop || !numbering) throw new AppError("NOT_FOUND", "Shop settings not found");

      const businessDate = businessDateFor(now, lockedShop.timezone, numbering.dayStartHour);
      const fy = financialYearOf(businessDate);
      // Always bill counter first, then token counter.
      const billNumber = await nextSequenceValue(tx, ctx.shopId, billSequenceKey(fy));
      const tokenNumber = await nextSequenceValue(
        tx,
        ctx.shopId,
        tokenSequenceKey(numbering.tokenResetMode, businessDate),
      );

      const [bill] = await tx
        .insert(bills)
        .values({
          shopId: ctx.shopId,
          billNumber,
          billNumberDisplay: formatBillNumber(numbering.billPrefix, fy, billNumber),
          tokenNumber,
          businessDate,
          status: "COMPLETED",
          subtotalPaise: totals.subtotalPaise,
          discountType: discount?.type ?? null,
          discountValue: discount?.value ?? 0,
          discountPaise: totals.discountPaise,
          taxablePaise: totals.taxablePaise,
          cgstPaise: totals.cgstPaise,
          sgstPaise: totals.sgstPaise,
          taxPaise: totals.taxPaise,
          taxIncluded: gst.enabled && gst.inclusive,
          roundOffPaise: totals.roundOffPaise,
          totalPaise: totals.totalPaise,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          createdBy: ctx.userId,
          createdAt: now,
          idempotencyKey: input.idempotencyKey,
          shopSnapshot,
          gstSnapshot,
        })
        .returning({ id: bills.id });

      await tx.insert(billItems).values(
        lines.map((l, i) => ({
          shopId: ctx.shopId,
          billId: bill.id,
          productId: l.productId,
          productName: l.productName,
          categoryName: l.categoryName,
          unitPricePaise: l.unitPricePaise,
          quantity: l.quantity,
          lineTotalPaise: l.unitPricePaise * l.quantity,
          sortOrder: i,
        })),
      );

      await tx.insert(payments).values(
        payment.method === "CASH"
          ? {
              shopId: ctx.shopId,
              billId: bill.id,
              method: "CASH" as const,
              amountPaise: totals.totalPaise,
              cashTenderedPaise: payment.cashTenderedPaise,
              changePaise: payment.cashTenderedPaise - totals.totalPaise,
              createdAt: now,
            }
          : {
              shopId: ctx.shopId,
              billId: bill.id,
              method: "UPI" as const,
              amountPaise: totals.totalPaise,
              upiReference: payment.reference,
              createdAt: now,
            },
      );

      await recordAudit(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        action: "BILL_CREATED",
        entityType: "bill",
        entityId: bill.id,
        meta: { billNumber, tokenNumber, totalPaise: totals.totalPaise, paymentMethod: payment.method },
      });

      const detail = await getBillDetail(tx, ctx.shopId, bill.id);
      if (!detail) throw new Error("created bill could not be read back");
      return detail;
    });
  } catch (e) {
    if (!isIdempotencyConflict(e)) throw e;
    // A concurrent call with the same key committed first. Our transaction
    // (counters included) rolled back; return the bill that won.
    const winnerId = await findBillIdByKey(db, ctx.shopId, input.idempotencyKey);
    const winner = winnerId ? await getBillDetail(db, ctx.shopId, winnerId) : null;
    if (!winner) throw e;
    return winner;
  }
}
