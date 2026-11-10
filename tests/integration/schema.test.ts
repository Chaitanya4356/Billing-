import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { billItems, payments, products, shopSettings, shops, users } from "@/db/schema";
import { makeProduct, makeShop, resetDb, type TestShop } from "../helpers/db";
import { seedShop } from "../../scripts/seed";

interface BillOverrides {
  billNumber?: number;
  financialYear?: string;
  tokenNumber?: number;
  businessDate?: string;
  idempotencyKey?: string;
  subtotalPaise?: number;
  discountPaise?: number;
  taxPaise?: number;
  roundOffPaise?: number;
  totalPaise?: number;
  taxIncluded?: boolean;
}

// Raw insert: bypasses application code so that only DB constraints are tested.
async function insertBill(t: TestShop, o: BillOverrides = {}): Promise<string> {
  const billNumber = o.billNumber ?? 1;
  const subtotal = o.subtotalPaise ?? 10000;
  const discount = o.discountPaise ?? 0;
  const tax = o.taxPaise ?? 0;
  const roundOff = o.roundOffPaise ?? 0;
  const taxIncluded = o.taxIncluded ?? true;
  const total = o.totalPaise ?? subtotal - discount + (taxIncluded ? 0 : tax) + roundOff;
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO bills (
      shop_id, financial_year, bill_number, bill_number_display, token_number, business_date,
      status, subtotal_paise, discount_paise, taxable_paise, cgst_paise,
      sgst_paise, tax_paise, round_off_paise, total_paise, tax_included,
      created_by, idempotency_key, shop_snapshot, gst_snapshot
    ) VALUES (
      ${t.shopId}, ${o.financialYear ?? "2026-27"}, ${billNumber}, ${"B-" + billNumber},
      ${o.tokenNumber ?? 1}, ${o.businessDate ?? "2026-11-10"},
      'COMPLETED', ${subtotal}, ${discount}, ${subtotal - discount}, 0,
      0, ${tax}, ${roundOff}, ${total}, ${taxIncluded},
      ${t.owner.id}, ${o.idempotencyKey ?? "key-1"}, '{}'::jsonb, '{}'::jsonb
    ) RETURNING id
  `);
  return result.rows[0].id;
}

function item(shopId: string, billId: string, productId?: string, quantity = 1) {
  return {
    shopId,
    billId,
    productId,
    productName: "Tea",
    categoryName: "Drinks",
    unitPricePaise: 1000,
    quantity,
    lineTotalPaise: 1000 * quantity,
    sortOrder: 0,
  };
}

function payment(shopId: string, billId: string) {
  return { shopId, billId, method: "CASH" as const, amountPaise: 10000 };
}

// drizzle wraps driver errors; the pg error (with SQLSTATE) is on `cause`.
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.cause?.code ?? e?.code;
}

describe("schema constraints", () => {
  let t: TestShop;

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
  });

  it("rejects a duplicate (shop_id, financial_year, bill_number) but accepts the number in another FY", async () => {
    await insertBill(t, { billNumber: 1, tokenNumber: 1, idempotencyKey: "a" });
    const err = await insertBill(t, { billNumber: 1, tokenNumber: 2, idempotencyKey: "b" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(pgCode(err)).toBe("23505");
    await expect(
      insertBill(t, {
        billNumber: 1,
        financialYear: "2027-28",
        tokenNumber: 1,
        businessDate: "2027-04-01",
        idempotencyKey: "c",
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects a duplicate token on the same business date but accepts it on another date", async () => {
    await insertBill(t, { billNumber: 1, tokenNumber: 5, idempotencyKey: "a" });
    await expect(
      insertBill(t, { billNumber: 2, tokenNumber: 5, idempotencyKey: "b" }),
    ).rejects.toThrow();
    await expect(
      insertBill(t, {
        billNumber: 3,
        tokenNumber: 5,
        businessDate: "2026-11-11",
        idempotencyKey: "c",
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects a duplicate (shop_id, idempotency_key)", async () => {
    await insertBill(t, { billNumber: 1, tokenNumber: 1, idempotencyKey: "same" });
    await expect(
      insertBill(t, { billNumber: 2, tokenNumber: 2, idempotencyKey: "same" }),
    ).rejects.toThrow();
  });

  it("rejects bill item quantity = 0", async () => {
    const billId = await insertBill(t);
    await expect(db.insert(billItems).values(item(t.shopId, billId, undefined, 0))).rejects.toThrow();
  });

  it("rejects a negative unit price", async () => {
    const billId = await insertBill(t);
    await expect(
      db.insert(billItems).values({ ...item(t.shopId, billId), unitPricePaise: -1 }),
    ).rejects.toThrow();
  });

  it("rejects a bill whose total does not match the formula", async () => {
    await expect(
      insertBill(t, { subtotalPaise: 10000, discountPaise: 1000, totalPaise: 10000 }),
    ).rejects.toThrow();
    // exclusive GST: tax must be added
    await expect(
      insertBill(t, {
        billNumber: 2,
        tokenNumber: 2,
        idempotencyKey: "b",
        taxIncluded: false,
        taxPaise: 500,
        totalPaise: 10000,
      }),
    ).rejects.toThrow();
    // inclusive GST: tax must NOT be added
    await expect(
      insertBill(t, {
        billNumber: 3,
        tokenNumber: 3,
        idempotencyKey: "c",
        taxIncluded: true,
        taxPaise: 500,
        totalPaise: 10500,
      }),
    ).rejects.toThrow();
  });

  it("rejects a negative bill total", async () => {
    await expect(insertBill(t, { subtotalPaise: 100, discountPaise: 200 })).rejects.toThrow();
  });

  it("accepts correct totals for both tax_included variants", async () => {
    await expect(
      insertBill(t, {
        billNumber: 1,
        tokenNumber: 1,
        idempotencyKey: "a",
        taxIncluded: true,
        subtotalPaise: 10000,
        discountPaise: 1000,
        taxPaise: 429,
        roundOffPaise: 0,
        totalPaise: 9000,
      }),
    ).resolves.toBeTruthy();
    await expect(
      insertBill(t, {
        billNumber: 2,
        tokenNumber: 2,
        idempotencyKey: "b",
        taxIncluded: false,
        subtotalPaise: 10000,
        discountPaise: 1000,
        taxPaise: 450,
        roundOffPaise: 50,
        totalPaise: 9500,
      }),
    ).resolves.toBeTruthy();
  });

  it("does not cascade-delete bill items when a referenced product row is deleted", async () => {
    const productId = await makeProduct(t.shopId, { name: "Tea", pricePaise: 1000 });
    const billId = await insertBill(t);
    await db.insert(billItems).values(item(t.shopId, billId, productId));
    // Deleting a referenced product is blocked (no cascade); the item survives.
    await expect(db.delete(products).where(eq(products.id, productId))).rejects.toThrow();
    const items = await db.select().from(billItems).where(eq(billItems.billId, billId));
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe(productId);
  });

  it("rejects deleting a bill that still has items or payments (no cascade)", async () => {
    const billId = await insertBill(t);
    await db.insert(billItems).values(item(t.shopId, billId));
    await db.insert(payments).values(payment(t.shopId, billId));
    await expect(db.execute(sql`DELETE FROM bills WHERE id = ${billId}`)).rejects.toThrow();
    expect(await db.select().from(billItems).where(eq(billItems.billId, billId))).toHaveLength(1);
    expect(await db.select().from(payments).where(eq(payments.billId, billId))).toHaveLength(1);
  });

  it("rejects an item or payment whose shop_id differs from its bill's shop_id (23503)", async () => {
    const other = await makeShop();
    const billId = await insertBill(t);
    const itemErr = await db.insert(billItems).values(item(other.shopId, billId)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(pgCode(itemErr)).toBe("23503");
    const payErr = await db.insert(payments).values(payment(other.shopId, billId)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(pgCode(payErr)).toBe("23503");
  });

  it("enforces category names unique per shop, case-insensitively", async () => {
    await expect(
      db.execute(sql`
        INSERT INTO categories (shop_id, name, sort_order)
        VALUES (${t.shopId}, 'DRINKS', 1), (${t.shopId}, 'drinks', 2)
      `),
    ).rejects.toThrow();
  });
});

describe("seedShop", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is idempotent: calling twice leaves one shop and one owner", async () => {
    const env = {
      shopName: "Corner Cafe",
      ownerUsername: "boss",
      ownerPassword: "boss-pass-123",
    };
    await seedShop(env);
    await seedShop(env);
    expect(await db.select().from(shops)).toHaveLength(1);
    const owners = await db.select().from(users);
    expect(owners).toHaveLength(1);
    expect(owners[0].role).toBe("OWNER");
    const settings = await db.select().from(shopSettings);
    expect(settings).toHaveLength(1);
    expect(settings[0].tokenResetMode).toBe("DAILY");
    expect(settings[0].receiptFooter).toBe("Thank you! Visit again");
  });
});
