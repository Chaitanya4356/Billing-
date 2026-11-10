import { config } from "dotenv";
import { expect, type Locator, type Page } from "@playwright/test";
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

/** Turns "cashiers can cancel bills" on or off (test database only). */
export async function setCashierCanCancel(shopId: string, allowed: boolean): Promise<void> {
  pointAtTestDatabase();
  const db = await import("../helpers/db");
  await db.setCashierCanCancel(shopId, allowed);
}

/** Moves a bill's business date back one day (or `days`) and returns the new YYYY-MM-DD (test database only). */
export async function moveBillBusinessDateBack(shopId: string, billNumber: string, days = 1): Promise<string> {
  pointAtTestDatabase();
  const db = await import("../helpers/db");
  return db.moveBillBusinessDateBack(shopId, billNumber, days);
}

// ---------------------------------------------------------------------------
// Billing screen and print seam, shared by the billing and bills specs.
// ---------------------------------------------------------------------------

/** Installs the print test seam: every receipt HTML is collected in window.__printed. */
export async function installPrintHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: string[]; __PRINT_HOOK__: (html: string) => void };
    w.__printed = [];
    w.__PRINT_HOOK__ = (html: string) => {
      w.__printed.push(html);
    };
  });
}

/** The receipts handed to the print hook so far on the current page. */
export function printed(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __printed: string[] }).__printed);
}

/** Signs in and lands on the billing screen (an owner is sent to the dashboard first). */
export async function openBillingAs(
  page: Page,
  user: { username: string; password: string },
  role: "OWNER" | "CASHIER",
): Promise<void> {
  await installPrintHook(page);
  await login(page, user.username, user.password);
  if (role === "CASHIER") {
    await expect(page).toHaveURL(/\/billing$/);
  } else {
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/billing");
  }
  await expect(page.getByRole("searchbox", { name: "Search products" })).toBeVisible();
}

export const tile = (page: Page, name: string): Locator => page.getByRole("button", { name: new RegExp(`^Add ${name}`) });
export const cart = (page: Page): Locator => page.getByRole("region", { name: "Cart" });
export const payable = (page: Page): Locator => page.getByTestId("payable-amount");
export const chargeButton = (page: Page): Locator => page.getByRole("button", { name: /^Charge/ });
export const cashInput = (page: Page): Locator => page.getByLabel("Cash received (₹)");
export const successDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Bill saved" });

/** Pays the current cart in cash with the Exact button and waits for the success screen. */
export async function chargeExact(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Exact", exact: true }).click();
  await expect(chargeButton(page)).toBeEnabled();
  await chargeButton(page).click();
  await expect(successDialog(page)).toBeVisible();
}

/** Closes the success screen, leaving an empty billing screen. */
export async function newBill(page: Page): Promise<void> {
  await successDialog(page).getByRole("button", { name: "New Bill" }).click();
  await expect(successDialog(page)).toBeHidden();
}

/**
 * On an open billing screen: adds the lines, charges a cash bill with Exact and
 * returns the token and bill number from the success screen. With `print` the
 * receipt is printed once from the success screen (the original print), so a
 * later print of the bill is a REPRINT. Ends on a fresh, empty billing screen.
 */
export async function chargeCashBill(
  page: Page,
  lines: Array<{ name: string; qty: number }>,
  opts: { print?: boolean } = {},
): Promise<{ token: string; billNumber: string }> {
  for (const line of lines) {
    for (let i = 0; i < line.qty; i++) await tile(page, line.name).click();
  }
  await chargeExact(page);
  const success = successDialog(page);
  const token = (await success.getByTestId("success-token").innerText()).trim();
  const billNumber = (await success.getByTestId("success-bill-number").innerText()).trim();
  if (opts.print) {
    const before = (await printed(page)).length;
    await success.getByRole("button", { name: "Print" }).click();
    await expect.poll(async () => (await printed(page)).length).toBe(before + 1);
  }
  await newBill(page);
  return { token, billNumber };
}
