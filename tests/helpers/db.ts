import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../src/db/client";
import { bills, categories, products, shopSettings, shops, users } from "../../src/db/schema";
import type { AuthContext } from "../../src/lib/types";
import { hashPassword } from "../../src/modules/auth/password";
import { assertTestDatabaseUrl } from "./assert-test-db";

export interface TestUser {
  id: string;
  username: string;
  password: string;
  ctx: AuthContext;
}

export interface TestShop {
  shopId: string;
  owner: TestUser;
  cashier: TestUser;
  categoryId: string;
}

const OWNER_PASSWORD = "owner-pass-123";
const CASHIER_PASSWORD = "cashier-pass-123";

// argon2 is deliberately slow; hash each test password once per process.
let hashes: Promise<{ owner: string; cashier: string }> | undefined;
function testPasswordHashes(): Promise<{ owner: string; cashier: string }> {
  hashes ??= Promise.all([hashPassword(OWNER_PASSWORD), hashPassword(CASHIER_PASSWORD)]).then(
    ([owner, cashier]) => ({ owner, cashier }),
  );
  return hashes;
}

/** Truncates every table (and resets identity counters) in one statement. */
export async function resetDb(): Promise<void> {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  await db.execute(
    sql`TRUNCATE TABLE audit_logs, payments, bill_items, bills, number_sequences, sessions, products, categories, users, shop_settings, shops RESTART IDENTITY CASCADE`,
  );
}

export async function makeShop(
  opts: { settings?: Partial<typeof shopSettings.$inferInsert> } = {},
): Promise<TestShop> {
  const pw = await testPasswordHashes();
  return db.transaction(async (tx) => {
    const [shop] = await tx.insert(shops).values({ name: "Test Shop" }).returning({ id: shops.id });
    await tx.insert(shopSettings).values({ ...opts.settings, shopId: shop.id });
    const [owner] = await tx
      .insert(users)
      .values({
        shopId: shop.id,
        name: "Test Owner",
        username: "owner",
        passwordHash: pw.owner,
        role: "OWNER",
      })
      .returning({ id: users.id });
    const [cashier] = await tx
      .insert(users)
      .values({
        shopId: shop.id,
        name: "Test Cashier",
        username: "cashier",
        passwordHash: pw.cashier,
        role: "CASHIER",
      })
      .returning({ id: users.id });
    const [category] = await tx
      .insert(categories)
      .values({ shopId: shop.id, name: "General" })
      .returning({ id: categories.id });
    return {
      shopId: shop.id,
      owner: {
        id: owner.id,
        username: "owner",
        password: OWNER_PASSWORD,
        ctx: { shopId: shop.id, userId: owner.id, role: "OWNER" },
      },
      cashier: {
        id: cashier.id,
        username: "cashier",
        password: CASHIER_PASSWORD,
        ctx: { shopId: shop.id, userId: cashier.id, role: "CASHIER" },
      },
      categoryId: category.id,
    };
  });
}

export async function makeProduct(
  shopId: string,
  p: { name: string; pricePaise: number; categoryId?: string; isActive?: boolean },
): Promise<string> {
  let categoryId = p.categoryId;
  if (!categoryId) {
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.shopId, shopId))
      .orderBy(asc(categories.sortOrder), asc(categories.name))
      .limit(1);
    if (existing) {
      categoryId = existing.id;
    } else {
      const [created] = await db
        .insert(categories)
        .values({ shopId, name: "General" })
        .returning({ id: categories.id });
      categoryId = created.id;
    }
  }
  const [row] = await db
    .insert(products)
    .values({
      shopId,
      categoryId,
      name: p.name,
      pricePaise: p.pricePaise,
      isActive: p.isActive ?? true,
    })
    .returning({ id: products.id });
  return row.id;
}

/** Sets a product's catalog price directly (e2e: simulate a price change behind the cashier's back). */
export async function setProductPrice(productId: string, pricePaise: number): Promise<void> {
  await db.update(products).set({ pricePaise }).where(eq(products.id, productId));
}

/** Sets a shop's GST settings directly (e2e: simulate a settings change behind the cashier's back). */
export async function setShopGst(
  shopId: string,
  gst: { enabled: boolean; rateBp: number; inclusive: boolean },
): Promise<void> {
  await db
    .update(shopSettings)
    .set({ gstEnabled: gst.enabled, gstRateBp: gst.rateBp, gstInclusive: gst.inclusive })
    .where(eq(shopSettings.shopId, shopId));
}

/** Number of bills stored for a shop. */
export async function countBills(shopId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(bills).where(eq(bills.shopId, shopId));
  return row?.n ?? 0;
}

/** Turns "cashiers can cancel bills" on or off for a shop. */
export async function setCashierCanCancel(shopId: string, allowed: boolean): Promise<void> {
  await db.update(shopSettings).set({ cashierCanCancel: allowed }).where(eq(shopSettings.shopId, shopId));
}

/**
 * Moves a bill's business_date back by `days` (default 1) and returns the new
 * date (YYYY-MM-DD). The bill is found by its displayed number, e.g. B-2627-000001.
 */
export async function moveBillBusinessDateBack(shopId: string, billNumberDisplay: string, days = 1): Promise<string> {
  const [row] = await db
    .update(bills)
    .set({ businessDate: sql`${bills.businessDate} - ${days}::int` })
    .where(and(eq(bills.shopId, shopId), eq(bills.billNumberDisplay, billNumberDisplay)))
    .returning({ businessDate: bills.businessDate });
  if (!row) throw new Error(`No bill ${billNumberDisplay} in shop ${shopId}`);
  return row.businessDate;
}
