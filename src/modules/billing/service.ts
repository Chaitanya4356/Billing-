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
import type { Totals } from "./calc";
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

/**
 * Current catalog rows for the cart, in cart order. Inactive, deleted or foreign products, and products of disabled
 * categories, are rejected.
 */
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
    // A disabled category hides its products on the billing screen; enforce it here too.
    .innerJoin(
      categories,
      and(
        eq(categories.id, products.categoryId),
        eq(categories.shopId, products.shopId),
        eq(categories.isActive, true),
      ),
    )
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

type SettingsRow = typeof shopSettings.$inferSelect;

interface Priced {
  totals: Totals;
  gst: { enabled: boolean; rateBp: number; inclusive: boolean };
}

/**
 * Pure: the cashier discount limit, totals, the expected-total comparison and
 * the payment check for one settings row. Run before the transaction (early rejection, no numbers consumed) and
 * again inside it on the locked row, whose result is what gets stored.
 */
function priceBill(
  role: AuthContext["role"],
  settings: SettingsRow,
  lines: PricedLine[],
  input: ParsedCreateBillInput,
): Priced {
  const { discount, payment } = input;
  if (discount && role === "CASHIER") {
    const limit = discount.type === "PERCENT" ? settings.cashierDiscountMaxPctBp : settings.cashierDiscountMaxFlatPaise;
    if (discount.value > limit) {
      throw new AppError("DISCOUNT_LIMIT", "This discount is above the cashier limit. Ask the owner to apply it.");
    }
  }

  const gst = { enabled: settings.gstEnabled, rateBp: settings.gstRateBp, inclusive: settings.gstInclusive };
  const totals = calculateTotals({ lines, discount, gst, roundToRupee: settings.roundToRupee });

  // The cart's item prices were already checked; this catches everything else
  // that moves the total (GST on/rate/inclusive, rounding). Checked before the
  // cash check so the cashier is never told cash is short for a total they
  // were not shown.
  if (input.expectedTotalPaise !== totals.totalPaise) {
    throw new AppError(
      "PRICE_CHANGED",
      "The total changed (prices or tax/discount settings were updated). Please review the bill.",
      { expectedTotalPaise: input.expectedTotalPaise, actualTotalPaise: totals.totalPaise },
    );
  }

  if (payment.method === "CASH" && payment.cashTenderedPaise < totals.totalPaise) {
    throw new AppError("INSUFFICIENT_CASH", "Cash tendered is less than the bill total");
  }
  return { totals, gst };
}

/**
 * Creates a bill. Both roles. Validation, price checks, discount limits, totals
 * and the payment check all happen before the transaction, so a rejected
 * charge consumes no numbers. The transaction: idempotency lookup, settings
 * locks (and a re-price on the locked settings), bill counter, token counter,
 * inserts and audit, commit. A replay of an already used idempotency key
 * (also a concurrent one) returns the existing bill.
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

  const [preSettings] = await db.select().from(shopSettings).where(eq(shopSettings.shopId, ctx.shopId));
  if (!preSettings) throw new AppError("NOT_FOUND", "Shop settings not found");

  const lines = await loadLines(ctx.shopId, input);
  // Early rejection before any counter is touched.
  priceBill(ctx.role, preSettings, lines, input);

  const { discount, payment } = input;

  try {
    return await db.transaction(async (tx) => {
      const replay = await findBillIdByKey(tx, ctx.shopId, input.idempotencyKey);
      if (replay) {
        const existing = await getBillDetail(tx, ctx.shopId, replay);
        if (existing) return existing;
      }

      // Settings are re-read under a share lock, so a concurrent
      // updateSettings (which locks these rows FOR UPDATE, shops first) is
      // serialised with this bill: a tokenResetMode switch syncs counters
      // either before or after it, and nothing the bill stores can change
      // until commit. Same lock order as updateSettings: shops, then
      // shop_settings (otherwise the two could deadlock).
      const [shop] = await tx.select().from(shops).where(eq(shops.id, ctx.shopId)).for("key share");
      const [settings] = await tx
        .select()
        .from(shopSettings)
        .where(eq(shopSettings.shopId, ctx.shopId))
        .for("share");
      if (!shop || !settings) throw new AppError("NOT_FOUND", "Shop settings not found");

      // Totals, tax_included, payment amounts and both snapshots all come from
      // this one locked read, so a stored bill is always consistent with its
      // snapshots even if settings changed after the pre-check. The total must
      // still equal what the cashier displayed and collected (expectedTotalPaise).
      // A rejection here (total changed, limit lowered) rolls back before any
      // counter is touched: nextSequenceValue runs only after this line.
      const { totals, gst } = priceBill(ctx.role, settings, lines, input);
      const shopSnapshot: ShopSnapshot = { name: shop.name, address: shop.address, phone: shop.phone, gstin: shop.gstin };
      const gstSnapshot: GstSnapshot = { ...gst, title: settings.receiptTitle };

      const businessDate = businessDateFor(now, shop.timezone, settings.dayStartHour);
      const fy = financialYearOf(businessDate);
      // Always bill counter first, then token counter.
      const billNumber = await nextSequenceValue(tx, ctx.shopId, billSequenceKey(fy));
      const tokenNumber = await nextSequenceValue(
        tx,
        ctx.shopId,
        tokenSequenceKey(settings.tokenResetMode, businessDate),
      );

      const [bill] = await tx
        .insert(bills)
        .values({
          shopId: ctx.shopId,
          financialYear: fy,
          billNumber,
          billNumberDisplay: formatBillNumber(settings.billPrefix, fy, billNumber),
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
