import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditLogs, billItems, bills, numberSequences, payments } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { calculateTotals } from "@/modules/billing/calc";
import { createBill } from "@/modules/billing/service";
import type { CreateBillInput } from "@/modules/billing/schema";
import { getBillDetail } from "@/modules/bills/repo";
import { createCategory, deleteProduct, setCategoryActive, updateProduct } from "@/modules/catalog/service";
import { updateSettings } from "@/modules/shop/service";
import { makeProduct, makeShop, resetDb, type TestShop } from "../helpers/db";

/** 12:00 IST on 2026-11-10 (FY 2026-27). */
const NOW = new Date("2026-11-10T06:30:00Z");
const NEXT_DAY = new Date("2026-11-11T06:30:00Z");

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return "NO_ERROR";
}

async function seq(shopId: string, key: string): Promise<number | undefined> {
  const [row] = await db
    .select({ v: numberSequences.lastValue })
    .from(numberSequences)
    .where(and(eq(numberSequences.shopId, shopId), eq(numberSequences.key, key)));
  return row?.v;
}

async function billCount(shopId: string): Promise<number> {
  const rows = await db.select({ id: bills.id }).from(bills).where(eq(bills.shopId, shopId));
  return rows.length;
}

async function sequenceCount(shopId: string): Promise<number> {
  const rows = await db.select().from(numberSequences).where(eq(numberSequences.shopId, shopId));
  return rows.length;
}

/** Polls until some backend in this database waits on a lock (createBill blocked inside its transaction). */
async function waitForLockWaiter(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const r = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (r.rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("createBill never blocked on the settings lock");
}

/**
 * Deterministic interleaving: a second connection takes the same locks as
 * updateSettings (shops FOR UPDATE) and changes shop_settings without
 * committing. `run` (createBill) does its pre-transaction reads against the
 * old committed settings, then blocks on its in-transaction share lock; only
 * then is the change committed, so the bill transaction sees the new settings.
 */
async function interleaveSettingsChange<T>(
  shopId: string,
  settingsUpdate: string,
  run: () => Promise<T>,
  shopUpdate?: string,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT 1 FROM shops WHERE id = $1 FOR UPDATE", [shopId]);
    await c.query(`UPDATE shop_settings SET ${settingsUpdate} WHERE shop_id = $1`, [shopId]);
    if (shopUpdate) await c.query(`UPDATE shops SET ${shopUpdate} WHERE id = $1`, [shopId]);
    const pending = run().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await waitForLockWaiter();
    await c.query("COMMIT");
    return await pending;
  } finally {
    await c.end();
  }
}

interface View {
  gst: { enabled: boolean; rateBp: number; inclusive: boolean };
  roundToRupee: boolean;
}
const GST_OFF: View = { gst: { enabled: false, rateBp: 500, inclusive: true }, roundToRupee: false };

describe("createBill", () => {
  let t: TestShop;
  let dosa: string;
  let coffee: string;

  /**
   * What the cashier's screen displayed: the total computed, as the client
   * does, from the cart's own displayed prices (expectedUnitPricePaise), the
   * discount and the settings the screen was rendered with (default GST off,
   * no rounding). Returns 0 for carts the calculation itself rejects.
   */
  function displayedTotal(input: Partial<CreateBillInput>, view: View = GST_OFF): number {
    try {
      return calculateTotals({
        lines: (input.items ?? []).map((i) => ({ unitPricePaise: i.expectedUnitPricePaise, quantity: i.quantity })),
        discount: input.discount ?? null,
        gst: view.gst,
        roundToRupee: view.roundToRupee,
      }).totalPaise;
    } catch {
      return 0;
    }
  }

  /** 2 x Masala Dosa (60.00) + 1 x Filter Coffee (25.00) = 145.00, cash 200.00. */
  function cash(over: Partial<CreateBillInput> = {}, view: View = GST_OFF): CreateBillInput {
    const base = {
      idempotencyKey: randomUUID(),
      items: [
        { productId: dosa, quantity: 2, expectedUnitPricePaise: 6000 },
        { productId: coffee, quantity: 1, expectedUnitPricePaise: 2500 },
      ],
      discount: null,
      payment: { method: "CASH" as const, cashTenderedPaise: 20000 },
      ...over,
    };
    return { expectedTotalPaise: displayedTotal(base, view), ...base };
  }

  function upi(over: Partial<CreateBillInput> = {}, view: View = GST_OFF): CreateBillInput {
    return cash({ payment: { method: "UPI", confirmed: true, reference: "UTR123" }, ...over }, view);
  }

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
    dosa = await makeProduct(t.shopId, { name: "Masala Dosa", pricePaise: 6000 });
    coffee = await makeProduct(t.shopId, { name: "Filter Coffee", pricePaise: 2500 });
  });

  describe("numbering", () => {
    it("first bill is 1/1 with display B-2627-000001, snapshots items and cash; second is 2/2", async () => {
      const b = await createBill(t.cashier.ctx, cash(), NOW);
      expect(b.billNumber).toBe(1);
      expect(b.tokenNumber).toBe(1);
      expect(b.billNumberDisplay).toBe("B-2627-000001");
      expect(b.businessDate).toBe("2026-11-10");
      expect(b.status).toBe("COMPLETED");
      expect(b.items).toEqual([
        { productName: "Masala Dosa", categoryName: "General", unitPricePaise: 6000, quantity: 2, lineTotalPaise: 12000 },
        { productName: "Filter Coffee", categoryName: "General", unitPricePaise: 2500, quantity: 1, lineTotalPaise: 2500 },
      ]);
      expect(b.subtotalPaise).toBe(14500);
      expect(b.totalPaise).toBe(14500);
      expect(b.discountType).toBeNull();
      expect(b.discountValue).toBe(0);
      expect(b.payment).toEqual({
        method: "CASH",
        amountPaise: 14500,
        cashTenderedPaise: 20000,
        changePaise: 5500,
        upiReference: null,
        status: "RECORDED",
      });
      expect(b.printCount).toBe(0);
      expect(b.cancelledAt).toBeNull();
      expect(b.cancelReason).toBeNull();
      expect(b.customerName).toBeNull();
      expect(b.customerPhone).toBeNull();
      expect(b.shopSnapshot).toEqual({ name: "Test Shop", address: "", phone: "", gstin: null });
      expect(b.gstSnapshot).toEqual({ enabled: false, rateBp: 500, inclusive: true, title: "Tax Invoice" });

      const [itemRow] = await db.select().from(billItems).where(eq(billItems.billId, b.id)).limit(1);
      expect(itemRow.shopId).toBe(t.shopId);
      const [payRow] = await db.select().from(payments).where(eq(payments.billId, b.id));
      expect(payRow.shopId).toBe(t.shopId);

      const b2 = await createBill(t.owner.ctx, cash(), NOW);
      expect(b2.billNumber).toBe(2);
      expect(b2.tokenNumber).toBe(2);
      expect(b2.billNumberDisplay).toBe("B-2627-000002");
    });

    it("preserves cart order of items", async () => {
      const b = await createBill(
        t.cashier.ctx,
        cash({
          items: [
            { productId: coffee, quantity: 3, expectedUnitPricePaise: 2500 },
            { productId: dosa, quantity: 1, expectedUnitPricePaise: 6000 },
          ],
        }),
        NOW,
      );
      expect(b.items.map((i) => i.productName)).toEqual(["Filter Coffee", "Masala Dosa"]);
    });

    it("uses the configured bill prefix", async () => {
      await updateSettings(t.owner.ctx, { billPrefix: "KF" });
      const b = await createBill(t.cashier.ctx, cash(), NOW);
      expect(b.billNumberDisplay).toBe("KF-2627-000001");
    });

    it("next business day: token restarts at 1, bill number continues", async () => {
      await createBill(t.cashier.ctx, cash(), NOW);
      await createBill(t.cashier.ctx, cash(), NOW);
      const b = await createBill(t.cashier.ctx, cash(), NEXT_DAY);
      expect(b.businessDate).toBe("2026-11-11");
      expect(b.billNumber).toBe(3);
      expect(b.tokenNumber).toBe(1);
    });

    it("tokenResetMode NEVER: token continues across days", async () => {
      await updateSettings(t.owner.ctx, { tokenResetMode: "NEVER" }, NOW);
      await createBill(t.cashier.ctx, cash(), NOW);
      await createBill(t.cashier.ctx, cash(), NOW);
      const b = await createBill(t.cashier.ctx, cash(), NEXT_DAY);
      expect(b.billNumber).toBe(3);
      expect(b.tokenNumber).toBe(3);
      expect(await seq(t.shopId, "token:all")).toBe(3);
    });

    it("bill numbers restart in a new financial year; display uses the FY", async () => {
      await createBill(t.cashier.ctx, cash(), new Date("2027-03-31T06:30:00Z"));
      const march = await createBill(t.cashier.ctx, cash(), new Date("2027-03-31T06:30:00Z"));
      expect(march.businessDate).toBe("2027-03-31");
      expect(march.billNumber).toBe(2);
      expect(march.billNumberDisplay).toBe("B-2627-000002");
      const april = await createBill(t.cashier.ctx, cash(), new Date("2027-04-01T06:30:00Z"));
      expect(april.businessDate).toBe("2027-04-01");
      expect(april.billNumber).toBe(1);
      expect(april.billNumberDisplay).toBe("B-2728-000001");
      expect(april.tokenNumber).toBe(1);
      const [row] = await db.select({ fy: bills.financialYear }).from(bills).where(eq(bills.id, april.id));
      expect(row.fy).toBe("2027-28");
      expect(await seq(t.shopId, "bill:2026-27")).toBe(2);
      expect(await seq(t.shopId, "bill:2027-28")).toBe(1);
    });

    it("23:59:59 IST belongs to that date; 00:30 IST to the next date with token 1", async () => {
      const late = await createBill(t.cashier.ctx, cash(), new Date("2026-11-09T18:29:59Z"));
      expect(late.businessDate).toBe("2026-11-09");
      expect(late.tokenNumber).toBe(1);
      const late2 = await createBill(t.cashier.ctx, cash(), new Date("2026-11-09T18:29:59Z"));
      expect(late2.tokenNumber).toBe(2);
      const after = await createBill(t.cashier.ctx, cash(), new Date("2026-11-09T19:00:00Z"));
      expect(after.businessDate).toBe("2026-11-10");
      expect(after.tokenNumber).toBe(1);
      expect(after.billNumber).toBe(3);
    });

    it("with dayStartHour 4, 02:00 IST belongs to the previous business date", async () => {
      await updateSettings(t.owner.ctx, { dayStartHour: 4 });
      const b = await createBill(t.cashier.ctx, cash(), new Date("2026-11-10T20:30:00Z")); // 02:00 IST 11-11
      expect(b.businessDate).toBe("2026-11-10");
      const b2 = await createBill(t.cashier.ctx, cash(), new Date("2026-11-10T22:30:00Z")); // 04:00 IST 11-11
      expect(b2.businessDate).toBe("2026-11-11");
      expect(b2.tokenNumber).toBe(1);
    });

    it("50 parallel createBill calls produce bill numbers 1..50 and tokens 1..50", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 50 }, (_, i) => createBill(i % 2 ? t.owner.ctx : t.cashier.ctx, cash(), NOW)),
      );
      const failures = results.filter((r) => r.status === "rejected");
      expect(failures).toEqual([]);
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const expected = Array.from({ length: 50 }, (_, i) => i + 1);
      expect(ok.map((b) => b.billNumber).sort((a, b) => a - b)).toEqual(expected);
      expect(ok.map((b) => b.tokenNumber).sort((a, b) => a - b)).toEqual(expected);
      for (const b of ok) expect(b.tokenNumber).toBe(b.billNumber); // same order: bill counter, then token
      expect(await seq(t.shopId, "bill:2026-27")).toBe(50);
      expect(await seq(t.shopId, "token:2026-11-10")).toBe(50);
      expect(await billCount(t.shopId)).toBe(50);
    });

    it("shops number independently", async () => {
      await createBill(t.cashier.ctx, cash(), NOW);
      const other = await makeShop();
      const tea = await makeProduct(other.shopId, { name: "Tea", pricePaise: 1500 });
      const b = await createBill(
        other.cashier.ctx,
        {
          idempotencyKey: randomUUID(),
          items: [{ productId: tea, quantity: 1, expectedUnitPricePaise: 1500 }],
          discount: null,
          expectedTotalPaise: 1500,
          payment: { method: "CASH", cashTenderedPaise: 1500 },
        },
        NOW,
      );
      expect(b.billNumber).toBe(1);
      expect(b.tokenNumber).toBe(1);
      expect(b.payment.changePaise).toBe(0);
    });

    it("a bill_number unique violation is rethrown, not treated as an idempotent replay", async () => {
      await createBill(t.cashier.ctx, cash(), NOW);
      // Corrupt the counter so the next bill collides on (shop_id, financial_year, bill_number).
      await db
        .update(numberSequences)
        .set({ lastValue: 0 })
        .where(and(eq(numberSequences.shopId, t.shopId), eq(numberSequences.key, "bill:2026-27")));
      await expect(createBill(t.cashier.ctx, cash(), NOW)).rejects.toThrow();
      expect(await billCount(t.shopId)).toBe(1);
      expect(await seq(t.shopId, "bill:2026-27")).toBe(0); // rolled back
    });
  });

  describe("idempotency", () => {
    it("same key twice returns the same bill, one row, counters still at 1", async () => {
      const input = cash();
      const a = await createBill(t.cashier.ctx, input, NOW);
      const b = await createBill(t.cashier.ctx, input, NOW);
      expect(b.id).toBe(a.id);
      expect(b).toEqual(a);
      expect(await billCount(t.shopId)).toBe(1);
      expect(await seq(t.shopId, "bill:2026-27")).toBe(1);
      expect(await seq(t.shopId, "token:2026-11-10")).toBe(1);
    });

    it("concurrent calls with the same key produce exactly one bill and all return it", async () => {
      for (let round = 1; round <= 5; round++) {
        const input = cash();
        const results = await Promise.all([
          createBill(t.cashier.ctx, input, NOW),
          createBill(t.cashier.ctx, input, NOW),
          createBill(t.owner.ctx, input, NOW),
        ]);
        expect(new Set(results.map((r) => r.id)).size).toBe(1);
        expect(results[0].billNumber).toBe(round);
        expect(results[0].tokenNumber).toBe(round);
        expect(await billCount(t.shopId)).toBe(round);
        expect(await seq(t.shopId, "bill:2026-27")).toBe(round);
        expect(await seq(t.shopId, "token:2026-11-10")).toBe(round);
      }
      const audits = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.shopId, t.shopId), eq(auditLogs.action, "BILL_CREATED")));
      expect(audits).toHaveLength(5);
    });

    it("the same key in another shop is a different bill", async () => {
      const input = cash();
      await createBill(t.cashier.ctx, input, NOW);
      const other = await makeShop();
      const tea = await makeProduct(other.shopId, { name: "Tea", pricePaise: 1500 });
      const b = await createBill(
        other.cashier.ctx,
        { ...input, items: [{ productId: tea, quantity: 1, expectedUnitPricePaise: 1500 }], expectedTotalPaise: 1500 },
        NOW,
      );
      expect(b.items[0].productName).toBe("Tea");
    });
  });

  describe("rejections consume no numbers", () => {
    it("PRICE_CHANGED when the expected price differs; next valid bill is 1/1", async () => {
      await updateProduct(t.owner.ctx, dosa, { pricePaise: 6500 });
      let err: unknown;
      try {
        await createBill(t.cashier.ctx, cash(), NOW);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("PRICE_CHANGED");
      expect(JSON.stringify((err as AppError).details)).toContain("Masala Dosa");
      expect(JSON.stringify((err as AppError).details)).not.toContain("Filter Coffee");
      expect(await billCount(t.shopId)).toBe(0);
      expect(await sequenceCount(t.shopId)).toBe(0);

      const b = await createBill(
        t.cashier.ctx,
        cash({
          items: [
            { productId: dosa, quantity: 2, expectedUnitPricePaise: 6500 },
            { productId: coffee, quantity: 1, expectedUnitPricePaise: 2500 },
          ],
        }),
        NOW,
      );
      expect(b.billNumber).toBe(1);
      expect(b.tokenNumber).toBe(1);
      expect(b.totalPaise).toBe(15500);
    });

    it("expectedUnitPricePaise is never used for calculation", async () => {
      // A lower expected price than the catalog is rejected, never charged.
      expect(
        await code(
          createBill(
            t.cashier.ctx,
            cash({ items: [{ productId: dosa, quantity: 1, expectedUnitPricePaise: 1 }] }),
            NOW,
          ),
        ),
      ).toBe("PRICE_CHANGED");
    });

    it("INSUFFICIENT_CASH leaves no number consumed", async () => {
      expect(
        await code(createBill(t.cashier.ctx, cash({ payment: { method: "CASH", cashTenderedPaise: 14499 } }), NOW)),
      ).toBe("INSUFFICIENT_CASH");
      expect(await billCount(t.shopId)).toBe(0);
      expect(await sequenceCount(t.shopId)).toBe(0);
      const exact = await createBill(t.cashier.ctx, cash({ payment: { method: "CASH", cashTenderedPaise: 14500 } }), NOW);
      expect(exact.billNumber).toBe(1);
      expect(exact.tokenNumber).toBe(1);
      expect(exact.payment.changePaise).toBe(0);
    });

    it("INVALID_PRODUCT for inactive, soft-deleted and other-shop products", async () => {
      const inactive = await makeProduct(t.shopId, { name: "Old Item", pricePaise: 1000, isActive: false });
      const deleted = await makeProduct(t.shopId, { name: "Gone Item", pricePaise: 1000 });
      await deleteProduct(t.owner.ctx, deleted);
      const other = await makeShop();
      const foreign = await makeProduct(other.shopId, { name: "Foreign", pricePaise: 1000 });
      for (const productId of [inactive, deleted, foreign, randomUUID()]) {
        expect(
          await code(
            createBill(
              t.cashier.ctx,
              cash({
                items: [
                  { productId: dosa, quantity: 1, expectedUnitPricePaise: 6000 },
                  { productId, quantity: 1, expectedUnitPricePaise: 1000 },
                ],
              }),
              NOW,
            ),
          ),
        ).toBe("INVALID_PRODUCT");
      }
      expect(await billCount(t.shopId)).toBe(0);
      expect(await sequenceCount(t.shopId)).toBe(0);
    });

    it("INVALID_PRODUCT for a product whose category is disabled, without consuming numbers; re-enabling restores it", async () => {
      const snacks = await createCategory(t.owner.ctx, { name: "Snacks" });
      const vada = await makeProduct(t.shopId, { name: "Vada", pricePaise: 3000, categoryId: snacks.id });
      const vadaCart = () =>
        cash({
          items: [
            { productId: dosa, quantity: 1, expectedUnitPricePaise: 6000 },
            { productId: vada, quantity: 1, expectedUnitPricePaise: 3000 },
          ],
        });

      await setCategoryActive(t.owner.ctx, snacks.id, false);
      const err = await createBill(t.cashier.ctx, vadaCart(), NOW).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("INVALID_PRODUCT");
      expect((err as AppError).message).toBe("Some items are no longer available. Please review the cart.");
      expect(await billCount(t.shopId)).toBe(0);
      expect(await sequenceCount(t.shopId)).toBe(0);

      // A product in an active category still bills, and gets the first numbers.
      const first = await createBill(t.cashier.ctx, cash(), NOW);
      expect(first.billNumber).toBe(1);
      expect(first.tokenNumber).toBe(1);

      await setCategoryActive(t.owner.ctx, snacks.id, true);
      const restored = await createBill(t.cashier.ctx, vadaCart(), NOW);
      expect(restored.billNumber).toBe(2);
      expect(restored.items.map((i) => [i.productName, i.categoryName])).toEqual([
        ["Masala Dosa", "General"],
        ["Vada", "Snacks"],
      ]);
    });

    it("TOTAL_NOT_POSITIVE for a free-only cart", async () => {
      const free = await makeProduct(t.shopId, { name: "Water", pricePaise: 0 });
      expect(
        await code(
          createBill(
            t.owner.ctx,
            cash({ items: [{ productId: free, quantity: 1, expectedUnitPricePaise: 0 }] }),
            NOW,
          ),
        ),
      ).toBe("TOTAL_NOT_POSITIVE");
      expect(await sequenceCount(t.shopId)).toBe(0);
    });
  });

  describe("discounts", () => {
    it("cashier: any discount at the default limit 0 throws DISCOUNT_LIMIT", async () => {
      for (const discount of [
        { type: "PERCENT" as const, value: 1 },
        { type: "FLAT" as const, value: 1 },
      ]) {
        expect(await code(createBill(t.cashier.ctx, cash({ discount }), NOW))).toBe("DISCOUNT_LIMIT");
      }
      expect(await sequenceCount(t.shopId)).toBe(0);
    });

    it("cashier: within the configured limit succeeds, over it throws DISCOUNT_LIMIT", async () => {
      await updateSettings(t.owner.ctx, { cashierDiscountMaxPctBp: 1000, cashierDiscountMaxFlatPaise: 2000 });
      expect(
        await code(createBill(t.cashier.ctx, cash({ discount: { type: "PERCENT", value: 1001 } }), NOW)),
      ).toBe("DISCOUNT_LIMIT");
      expect(await code(createBill(t.cashier.ctx, cash({ discount: { type: "FLAT", value: 2001 } }), NOW))).toBe(
        "DISCOUNT_LIMIT",
      );
      const pct = await createBill(t.cashier.ctx, cash({ discount: { type: "PERCENT", value: 1000 } }), NOW);
      expect(pct.discountType).toBe("PERCENT");
      expect(pct.discountValue).toBe(1000);
      expect(pct.discountPaise).toBe(1450);
      expect(pct.totalPaise).toBe(13050);
      expect(pct.billNumber).toBe(1);
      const flat = await createBill(t.cashier.ctx, cash({ discount: { type: "FLAT", value: 2000 } }), NOW);
      expect(flat.discountPaise).toBe(2000);
      expect(flat.totalPaise).toBe(12500);
      expect(flat.payment.changePaise).toBe(7500);
    });

    it("owner is unlimited", async () => {
      const b = await createBill(t.owner.ctx, cash({ discount: { type: "PERCENT", value: 5000 } }), NOW);
      expect(b.discountPaise).toBe(7250);
      expect(b.totalPaise).toBe(7250);
      const f = await createBill(t.owner.ctx, cash({ discount: { type: "FLAT", value: 14000 } }), NOW);
      expect(f.totalPaise).toBe(500);
    });
  });

  describe("payments", () => {
    it("UPI with confirmed missing or false throws VALIDATION", async () => {
      const missing = cash({ payment: { method: "UPI" } as unknown as CreateBillInput["payment"] });
      const no = cash({ payment: { method: "UPI", confirmed: false } as unknown as CreateBillInput["payment"] });
      expect(await code(createBill(t.cashier.ctx, missing, NOW))).toBe("VALIDATION");
      expect(await code(createBill(t.cashier.ctx, no, NOW))).toBe("VALIDATION");
      expect(await sequenceCount(t.shopId)).toBe(0);
    });

    it("UPI payment amount equals the total, tendered and change null, reference stored", async () => {
      const b = await createBill(t.cashier.ctx, upi(), NOW);
      expect(b.payment).toEqual({
        method: "UPI",
        amountPaise: b.totalPaise,
        cashTenderedPaise: null,
        changePaise: null,
        upiReference: "UTR123",
        status: "RECORDED",
      });
      const blank = await createBill(
        t.cashier.ctx,
        upi({ payment: { method: "UPI", confirmed: true, reference: "   " } }),
        NOW,
      );
      expect(blank.payment.upiReference).toBeNull();
      const none = await createBill(t.cashier.ctx, upi({ payment: { method: "UPI", confirmed: true } }), NOW);
      expect(none.payment.upiReference).toBeNull();
    });
  });

  describe("history preservation", () => {
    it("bill keeps original product name/price and shop/GST snapshots after edits", async () => {
      const b = await createBill(t.cashier.ctx, cash(), NOW);
      await updateProduct(t.owner.ctx, dosa, { name: "Ghee Dosa", pricePaise: 9900 });
      await updateSettings(t.owner.ctx, {
        name: "Renamed Shop",
        address: "New Road",
        gstEnabled: true,
        gstRateBp: 1800,
        gstInclusive: false,
        receiptTitle: "Bill of Supply",
      });
      const again = await getBillDetail(db, t.shopId, b.id);
      expect(again).not.toBeNull();
      expect(again!.items[0]).toMatchObject({ productName: "Masala Dosa", unitPricePaise: 6000 });
      expect(again!.shopSnapshot).toEqual({ name: "Test Shop", address: "", phone: "", gstin: null });
      expect(again!.gstSnapshot).toEqual({ enabled: false, rateBp: 500, inclusive: true, title: "Tax Invoice" });
      expect(again).toEqual(b);
    });

    it("getBillDetail is scoped by shop and returns null for unknown ids", async () => {
      const b = await createBill(t.cashier.ctx, cash(), NOW);
      const other = await makeShop();
      expect(await getBillDetail(db, other.shopId, b.id)).toBeNull();
      expect(await getBillDetail(db, t.shopId, randomUUID())).toBeNull();
    });
  });

  describe("GST", () => {
    it("exclusive 500bp stores tax, cgst, sgst, taxIncluded false; total matches calculateTotals", async () => {
      await updateSettings(t.owner.ctx, { gstEnabled: true, gstRateBp: 500, gstInclusive: false });
      const view: View = { gst: { enabled: true, rateBp: 500, inclusive: false }, roundToRupee: false };
      const b = await createBill(t.cashier.ctx, cash({}, view), NOW);
      const expected = calculateTotals({
        lines: [
          { unitPricePaise: 6000, quantity: 2 },
          { unitPricePaise: 2500, quantity: 1 },
        ],
        discount: null,
        gst: { enabled: true, rateBp: 500, inclusive: false },
        roundToRupee: false,
      });
      expect(b.taxIncluded).toBe(false);
      expect(b.taxPaise).toBe(expected.taxPaise);
      expect(b.taxPaise).toBe(725);
      expect(b.cgstPaise).toBe(362);
      expect(b.sgstPaise).toBe(363);
      expect(b.taxablePaise).toBe(expected.taxablePaise);
      expect(b.totalPaise).toBe(expected.totalPaise);
      expect(b.totalPaise).toBe(15225);
      expect(b.payment.amountPaise).toBe(15225);
      expect(b.gstSnapshot).toEqual({ enabled: true, rateBp: 500, inclusive: false, title: "Tax Invoice" });
    });

    it("inclusive GST with rounding: taxIncluded true and the stored row satisfies the total check", async () => {
      await updateSettings(t.owner.ctx, { gstEnabled: true, gstRateBp: 1800, gstInclusive: true, roundToRupee: true });
      const view: View = { gst: { enabled: true, rateBp: 1800, inclusive: true }, roundToRupee: true };
      const b = await createBill(t.owner.ctx, cash({ discount: { type: "PERCENT", value: 333 } }, view), NOW);
      // 145.00 - 3.33% (4.83) = 140.17, rounded to 140.00
      expect(b.totalPaise).toBe(14000);
      expect(b.taxIncluded).toBe(true);
      expect(b.totalPaise % 100).toBe(0);
      expect(b.totalPaise).toBe(b.subtotalPaise - b.discountPaise + b.roundOffPaise);
      expect(b.cgstPaise + b.sgstPaise).toBe(b.taxPaise);
    });
  });

  describe("customer details and input validation", () => {
    it("normalizes the phone; blank is null; invalid is VALIDATION", async () => {
      const a = await createBill(
        t.cashier.ctx,
        cash({ customerPhone: " +91 98765 43210 ", customerName: "  Ravi  " }),
        NOW,
      );
      expect(a.customerPhone).toBe("+919876543210");
      expect(a.customerName).toBe("Ravi");
      const b = await createBill(t.cashier.ctx, cash({ customerPhone: "", customerName: "   " }), NOW);
      expect(b.customerPhone).toBeNull();
      expect(b.customerName).toBeNull();
      expect(await code(createBill(t.cashier.ctx, cash({ customerPhone: "abc" }), NOW))).toBe("VALIDATION");
      expect(await billCount(t.shopId)).toBe(2);
    });

    it("rejects malformed input with VALIDATION and consumes nothing", async () => {
      const item = { productId: dosa, quantity: 1, expectedUnitPricePaise: 6000 };
      const bad: CreateBillInput[] = [
        cash({ idempotencyKey: "not-a-uuid" }),
        cash({ items: [] }),
        cash({ items: Array.from({ length: 101 }, () => item) }),
        cash({ items: [item, { ...item, quantity: 2 }] }), // duplicate productId
        cash({ items: [{ ...item, quantity: 0 }] }),
        cash({ items: [{ ...item, quantity: 1000 }] }),
        cash({ items: [{ ...item, quantity: 1.5 }] }),
        cash({ items: [{ ...item, productId: "nope" }] }),
        cash({ items: [{ ...item, expectedUnitPricePaise: -1 }] }),
        cash({ discount: { type: "FLAT", value: 0 } }),
        cash({ discount: { type: "PERCENT", value: 1.5 } }),
        cash({ discount: undefined as unknown as null }),
        cash({ customerName: "x".repeat(61) }),
        cash({ payment: { method: "CASH", cashTenderedPaise: -1 } }),
        cash({ payment: { method: "CASH", cashTenderedPaise: 2_000_000_001 } }),
        cash({ payment: { method: "CASH", cashTenderedPaise: 100.5 } }),
        cash({ payment: { method: "CARD" } as unknown as CreateBillInput["payment"] }),
        upi({ payment: { method: "UPI", confirmed: true, reference: "r".repeat(41) } }),
        { ...cash(), shopId: randomUUID() } as unknown as CreateBillInput,
        cash({ items: [{ ...item, unitPricePaise: 1 } as unknown as CreateBillInput["items"][number]] }),
      ];
      for (const input of bad) {
        expect(await code(createBill(t.owner.ctx, input, NOW)), JSON.stringify(input).slice(0, 200)).toBe(
          "VALIDATION",
        );
      }
      expect(await billCount(t.shopId)).toBe(0);
      expect(await sequenceCount(t.shopId)).toBe(0);
    });

    it("accepts the boundary values", async () => {
      const b = await createBill(
        t.owner.ctx,
        cash({
          items: [{ productId: coffee, quantity: 999, expectedUnitPricePaise: 2500 }],
          customerName: "n".repeat(60),
          payment: { method: "CASH", cashTenderedPaise: 2_000_000_000 },
        }),
        NOW,
      );
      expect(b.totalPaise).toBe(2_497_500);
      expect(b.customerName).toHaveLength(60);
      const u = await createBill(t.owner.ctx, upi({ payment: { method: "UPI", confirmed: true, reference: "r".repeat(40) } }), NOW);
      expect(u.payment.upiReference).toHaveLength(40);
    });
  });

  describe("settings changed between the pre-check and the transaction", () => {
    function errorOf(r: { ok: true } | { ok: false; error: unknown }): AppError {
      if (r.ok) throw new Error("expected createBill to fail");
      expect(r.error).toBeInstanceOf(AppError);
      return r.error as AppError;
    }

    async function expectNothingConsumed(): Promise<void> {
      expect(await billCount(t.shopId)).toBe(0);
      expect(await sequenceCount(t.shopId)).toBe(0);
      const audits = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.shopId, t.shopId), eq(auditLogs.action, "BILL_CREATED")));
      expect(audits).toHaveLength(0);
    }

    it("GST switched on (total moves): PRICE_CHANGED inside the transaction, nothing consumed", async () => {
      const r = await interleaveSettingsChange(
        t.shopId,
        "gst_enabled = true, gst_rate_bp = 1800, gst_inclusive = false",
        () => createBill(t.cashier.ctx, cash(), NOW), // displayed and pre-checked: 145.00
      );
      const err = errorOf(r);
      expect(err.code).toBe("PRICE_CHANGED");
      expect(err.details).toEqual({ expectedTotalPaise: 14500, actualTotalPaise: 17110 });
      await expectNothingConsumed();
      const view: View = { gst: { enabled: true, rateBp: 1800, inclusive: false }, roundToRupee: false };
      const next = await createBill(t.cashier.ctx, cash({}, view), NOW);
      expect([next.billNumber, next.tokenNumber, next.totalPaise]).toEqual([1, 1, 17110]);
    });

    it("UPI: a total that moved after the cart was priced is rejected, never stored as received", async () => {
      const r = await interleaveSettingsChange(
        t.shopId,
        "gst_enabled = true, gst_rate_bp = 1800, gst_inclusive = false",
        () => createBill(t.cashier.ctx, upi(), NOW),
      );
      expect(errorOf(r).code).toBe("PRICE_CHANGED");
      await expectNothingConsumed();
      expect(await db.select().from(payments).where(eq(payments.shopId, t.shopId))).toHaveLength(0);
    });

    it("rounding switched on (total moves): PRICE_CHANGED, nothing consumed", async () => {
      await updateSettings(t.owner.ctx, { gstEnabled: true, gstRateBp: 500, gstInclusive: false });
      const view: View = { gst: { enabled: true, rateBp: 500, inclusive: false }, roundToRupee: false };
      const r = await interleaveSettingsChange(t.shopId, "round_to_rupee = true", () =>
        createBill(t.owner.ctx, cash({}, view), NOW), // displayed 152.25
      );
      const err = errorOf(r);
      expect(err.code).toBe("PRICE_CHANGED");
      expect(err.details).toEqual({ expectedTotalPaise: 15225, actualTotalPaise: 15200 });
      await expectNothingConsumed();
    });

    it("cashier discount limit lowered: DISCOUNT_LIMIT inside the transaction, nothing consumed", async () => {
      await updateSettings(t.owner.ctx, { cashierDiscountMaxPctBp: 1000 });
      const r = await interleaveSettingsChange(t.shopId, "cashier_discount_max_pct_bp = 0", () =>
        createBill(t.cashier.ctx, cash({ discount: { type: "PERCENT", value: 500 } }), NOW),
      );
      expect(errorOf(r).code).toBe("DISCOUNT_LIMIT");
      await expectNothingConsumed();
    });

    it("total unaffected (title, prefix, shop profile): bill succeeds with snapshots from the locked read", async () => {
      const r = await interleaveSettingsChange(
        t.shopId,
        "receipt_title = 'Cash Memo', bill_prefix = 'KF'",
        () => createBill(t.cashier.ctx, cash(), NOW),
        "name = 'Renamed Shop', address = '12 New Road'",
      );
      if (!r.ok) throw r.error;
      const b = r.value;
      expect(b.totalPaise).toBe(14500);
      expect(b.payment.amountPaise).toBe(14500);
      expect(b.billNumberDisplay).toBe("KF-2627-000001");
      expect(b.gstSnapshot).toEqual({ enabled: false, rateBp: 500, inclusive: true, title: "Cash Memo" });
      expect(b.shopSnapshot).toEqual({ name: "Renamed Shop", address: "12 New Road", phone: "", gstin: null });
    });

    it("inclusive GST switched on (total unchanged): stored tax and snapshot come from the locked read", async () => {
      const r = await interleaveSettingsChange(
        t.shopId,
        "gst_enabled = true, gst_rate_bp = 500, gst_inclusive = true",
        () => createBill(t.cashier.ctx, cash(), NOW), // pre-check: GST off, 145.00
      );
      if (!r.ok) throw r.error;
      const b = r.value;
      // Inclusive 5% on 145.00: taxable round(14500 * 10000 / 10500) = 13810, tax 690.
      expect(b.totalPaise).toBe(14500);
      expect(b.taxIncluded).toBe(true);
      expect(b.taxablePaise).toBe(13810);
      expect(b.taxPaise).toBe(690);
      expect([b.cgstPaise, b.sgstPaise]).toEqual([345, 345]);
      expect(b.gstSnapshot).toEqual({ enabled: true, rateBp: 500, inclusive: true, title: "Tax Invoice" });
      expect(b.totalPaise).toBe(b.subtotalPaise - b.discountPaise + b.roundOffPaise);
      expect(b.payment).toMatchObject({ amountPaise: 14500, cashTenderedPaise: 20000, changePaise: 5500 });
    });
  });

  describe("expectedTotalPaise", () => {
    it("a mismatch before the transaction is PRICE_CHANGED with details; nothing consumed", async () => {
      let err: unknown;
      try {
        await createBill(t.cashier.ctx, cash({ expectedTotalPaise: 14400 }), NOW);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("PRICE_CHANGED");
      expect((err as AppError).details).toEqual({ expectedTotalPaise: 14400, actualTotalPaise: 14500 });
      expect(await billCount(t.shopId)).toBe(0);
      expect(await sequenceCount(t.shopId)).toBe(0);
    });

    it("a matching total succeeds", async () => {
      const b = await createBill(t.cashier.ctx, cash({ expectedTotalPaise: 14500 }), NOW);
      expect(b.totalPaise).toBe(14500);
      expect(b.billNumber).toBe(1);
    });

    it("cart rendered before an owner's GST change and charged after it is rejected (cash and UPI)", async () => {
      const cashCart = cash(); // displayed with GST off: 145.00
      const upiCart = upi();
      await updateSettings(t.owner.ctx, { gstEnabled: true, gstRateBp: 500, gstInclusive: false });
      expect(await code(createBill(t.cashier.ctx, cashCart, NOW))).toBe("PRICE_CHANGED");
      expect(await code(createBill(t.cashier.ctx, upiCart, NOW))).toBe("PRICE_CHANGED");
      expect(await billCount(t.shopId)).toBe(0);
      expect(await sequenceCount(t.shopId)).toBe(0);
    });

    it("the expected total must reflect the discount", async () => {
      const discount = { type: "FLAT" as const, value: 1000 };
      // Displayed without the discount applied: rejected.
      expect(await code(createBill(t.owner.ctx, cash({ discount, expectedTotalPaise: 14500 }), NOW))).toBe(
        "PRICE_CHANGED",
      );
      const b = await createBill(t.owner.ctx, cash({ discount, expectedTotalPaise: 13500 }), NOW);
      expect(b.discountPaise).toBe(1000);
      expect(b.totalPaise).toBe(13500);
      expect(b.payment.changePaise).toBe(6500);
    });

    it("an item price change is reported with item details before any total comparison", async () => {
      await updateProduct(t.owner.ctx, coffee, { pricePaise: 3000 });
      let err: unknown;
      try {
        await createBill(t.cashier.ctx, cash(), NOW);
      } catch (e) {
        err = e;
      }
      expect((err as AppError).code).toBe("PRICE_CHANGED");
      expect(JSON.stringify((err as AppError).details)).toContain("Filter Coffee");
      expect((err as AppError).details).not.toHaveProperty("expectedTotalPaise");
    });

    it("is required and validated", async () => {
      const missing: Record<string, unknown> = { ...cash() };
      delete missing.expectedTotalPaise;
      for (const input of [
        missing as unknown as CreateBillInput,
        cash({ expectedTotalPaise: -1 }),
        cash({ expectedTotalPaise: 145.5 }),
        cash({ expectedTotalPaise: 2_000_000_001 }),
        cash({ expectedTotalPaise: "14500" as unknown as number }),
      ]) {
        expect(await code(createBill(t.owner.ctx, input, NOW))).toBe("VALIDATION");
      }
      expect(await sequenceCount(t.shopId)).toBe(0);
    });
  });

  describe("audit", () => {
    it("writes a BILL_CREATED audit row", async () => {
      const b = await createBill(t.cashier.ctx, cash(), NOW);
      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.shopId, t.shopId), eq(auditLogs.action, "BILL_CREATED")));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: t.cashier.id, entityType: "bill", entityId: b.id });
      expect(rows[0].meta).toEqual({ billNumber: 1, tokenNumber: 1, totalPaise: 14500, paymentMethod: "CASH" });
    });
  });

  describe("token reset mode changes", () => {
    async function tokensOn(date: string): Promise<number[]> {
      const rows = await db
        .select({ token: bills.tokenNumber })
        .from(bills)
        .where(and(eq(bills.shopId, t.shopId), eq(bills.businessDate, date)))
        .orderBy(asc(bills.billNumber));
      return rows.map((r) => r.token);
    }

    it("DAILY -> NEVER -> DAILY mid-day never produces a duplicate token for the rest of the day", async () => {
      const at = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00Z`);
      for (let i = 0; i < 3; i++) await createBill(t.cashier.ctx, cash(), at("04:00")); // tokens 1..3
      await updateSettings(t.owner.ctx, { tokenResetMode: "NEVER" }, at("05:00"));
      expect(await seq(t.shopId, "token:all")).toBe(3);
      const n1 = await createBill(t.cashier.ctx, cash(), at("05:10"));
      const n2 = await createBill(t.cashier.ctx, cash(), at("05:20"));
      expect([n1.tokenNumber, n2.tokenNumber]).toEqual([4, 5]);
      await updateSettings(t.owner.ctx, { tokenResetMode: "DAILY" }, at("06:00"));
      expect(await seq(t.shopId, "token:2026-11-10")).toBe(5);
      for (let i = 0; i < 3; i++) await createBill(t.cashier.ctx, cash(), at("07:00"));
      const tokens = await tokensOn("2026-11-10");
      expect(tokens).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      // Next day starts again at 1.
      const tomorrow = await createBill(t.cashier.ctx, cash(), NEXT_DAY);
      expect(tomorrow.tokenNumber).toBe(1);
    });

    it("NEVER -> DAILY -> NEVER keeps the all-time token above every issued token", async () => {
      await updateSettings(t.owner.ctx, { tokenResetMode: "NEVER" }, NOW);
      await createBill(t.cashier.ctx, cash(), new Date("2026-11-09T06:30:00Z")); // token 1 on 11-09
      await createBill(t.cashier.ctx, cash(), NOW); // token 2 on 11-10
      await updateSettings(t.owner.ctx, { tokenResetMode: "DAILY" }, NOW);
      const d = await createBill(t.cashier.ctx, cash(), NOW);
      expect(d.tokenNumber).toBe(3); // raised to today's max (2), never reusing 1 or 2
      await createBill(t.cashier.ctx, cash(), NOW); // 4
      await updateSettings(t.owner.ctx, { tokenResetMode: "NEVER" }, NOW);
      const n = await createBill(t.cashier.ctx, cash(), NOW);
      expect(n.tokenNumber).toBe(5);
      expect(await tokensOn("2026-11-10")).toEqual([2, 3, 4, 5]);
    });

    it("a dayStartHour change that moves the business date back resyncs that date's DAILY counter", async () => {
      // D = 2026-11-10 (Asia/Kolkata), day starting at midnight.
      const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
      await updateSettings(t.owner.ctx, { dayStartHour: 0 }, ist("2026-11-10", "11:00"));
      const d1 = await createBill(t.cashier.ctx, cash(), ist("2026-11-10", "12:00")); // DAILY token 1 on D
      expect([d1.businessDate, d1.tokenNumber]).toEqual(["2026-11-10", 1]);

      await updateSettings(t.owner.ctx, { tokenResetMode: "NEVER" }, ist("2026-11-10", "12:30"));
      const n1 = await createBill(t.cashier.ctx, cash(), ist("2026-11-10", "13:00"));
      const n2 = await createBill(t.cashier.ctx, cash(), ist("2026-11-10", "13:10"));
      expect([n1.tokenNumber, n2.tokenNumber]).toEqual([2, 3]); // NEVER tokens, still on D
      expect(await seq(t.shopId, "token:2026-11-10")).toBe(1); // D's DAILY counter is now behind

      // After midnight: back to DAILY syncs only the new business date D+1.
      const lateNight = ist("2026-11-11", "02:00");
      await updateSettings(t.owner.ctx, { tokenResetMode: "DAILY" }, lateNight);
      expect(await seq(t.shopId, "token:2026-11-11")).toBe(0);

      // The day now starts at 04:00, so 02:00 on D+1 belongs to D again.
      await updateSettings(t.owner.ctx, { dayStartHour: 4 }, lateNight);
      expect(await seq(t.shopId, "token:2026-11-10")).toBe(3);

      const next = await createBill(t.cashier.ctx, cash(), lateNight);
      expect(next.businessDate).toBe("2026-11-10");
      expect(next.tokenNumber).toBe(4);
      const tokens = await tokensOn("2026-11-10");
      expect(tokens).toEqual([1, 2, 3, 4]);
      expect(new Set(tokens).size).toBe(tokens.length);
    });

    it("syncing never lowers a counter", async () => {
      for (let i = 0; i < 4; i++) await createBill(t.cashier.ctx, cash(), NOW);
      await db
        .update(numberSequences)
        .set({ lastValue: 10 })
        .where(and(eq(numberSequences.shopId, t.shopId), eq(numberSequences.key, "token:2026-11-10")));
      await updateSettings(t.owner.ctx, { tokenResetMode: "NEVER" }, NOW);
      await updateSettings(t.owner.ctx, { tokenResetMode: "DAILY" }, NOW);
      expect(await seq(t.shopId, "token:2026-11-10")).toBe(10);
    });

    it("concurrent bills while the mode is toggled: no failures, no duplicate tokens", async () => {
      const billsP = Promise.allSettled(Array.from({ length: 30 }, () => createBill(t.cashier.ctx, cash(), NOW)));
      const togglesP = (async () => {
        for (let i = 0; i < 6; i++) {
          await updateSettings(t.owner.ctx, { tokenResetMode: i % 2 === 0 ? "NEVER" : "DAILY" }, NOW);
        }
      })();
      const [results] = await Promise.all([billsP, togglesP]);
      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      const tokens = await tokensOn("2026-11-10");
      expect(tokens).toHaveLength(30);
      expect(new Set(tokens).size).toBe(30);
      const numbers = await db
        .select({ n: sql<number>`max(${bills.billNumber})` })
        .from(bills)
        .where(eq(bills.shopId, t.shopId));
      expect(Number(numbers[0].n)).toBe(30);
    });
  });
});
