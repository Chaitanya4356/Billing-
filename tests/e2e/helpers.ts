import { config } from "dotenv";
import type { Page } from "@playwright/test";
import { assertTestDatabaseUrl } from "../helpers/assert-test-db";
import type { TestShop } from "../helpers/db";

/**
 * Points this Node process at the TEST database. Must run before anything
 * imports src/db/client.ts, which reads DATABASE_URL once at import time;
 * that is why ../helpers/db is only ever imported dynamically below.
 */
function pointAtTestDatabase(): void {
  config({ path: ".env", quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set (see .env.example)");
  assertTestDatabaseUrl(url);
  process.env.DATABASE_URL = url;
}

export interface SeededShop extends TestShop {
  /** Product ids seeded in the shop's category (both ₹15, active). */
  products: { masalaTea: string; samosa: string };
}

/**
 * Truncates the test database and seeds one shop with an owner, a cashier and
 * the products "Masala Tea" (₹15) and "Samosa" (₹15) in the seeded category.
 */
export async function resetAndSeed(): Promise<SeededShop> {
  pointAtTestDatabase();
  const { resetDb, makeShop, makeProduct } = await import("../helpers/db");
  await resetDb();
  const shop = await makeShop();
  const masalaTea = await makeProduct(shop.shopId, { name: "Masala Tea", pricePaise: 1500, categoryId: shop.categoryId });
  const samosa = await makeProduct(shop.shopId, { name: "Samosa", pricePaise: 1500, categoryId: shop.categoryId });
  return { ...shop, products: { masalaTea, samosa } };
}

/** Direct DB update of a product's price (test database only). */
export async function setProductPrice(productId: string, pricePaise: number): Promise<void> {
  pointAtTestDatabase();
  const db = await import("../helpers/db");
  await db.setProductPrice(productId, pricePaise);
}

/** Direct DB update of a shop's GST settings (test database only). */
export async function setShopGst(
  shopId: string,
  gst: { enabled: boolean; rateBp: number; inclusive: boolean },
): Promise<void> {
  pointAtTestDatabase();
  const db = await import("../helpers/db");
  await db.setShopGst(shopId, gst);
}

/** Number of bills stored for the shop (test database only). */
export async function countBills(shopId: string): Promise<number> {
  pointAtTestDatabase();
  const db = await import("../helpers/db");
  return db.countBills(shopId);
}

/** Signs in through the login form. Does not assert where it lands. */
export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
