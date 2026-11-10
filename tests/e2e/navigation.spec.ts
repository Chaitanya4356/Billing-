import { expect, test } from "@playwright/test";
import type { TestShop } from "../helpers/db";
import { login, resetAndSeed } from "./helpers";

let shop: TestShop;

test.beforeAll(async () => {
  shop = await resetAndSeed();
});

const OWNER_ONLY = ["products", "reports", "dashboard", "settings"] as const;
const OWNER_LABELS = ["Billing", "Bills", "Products", "Reports", "Dashboard", "Settings"];

// The layout renders the nav once; read the labels of its links.
async function navLabels(page: import("@playwright/test").Page): Promise<string[]> {
  const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
  return (await links.allTextContents()).map((t) => t.trim());
}

test("unauthenticated visit to /billing redirects to /login", async ({ page }) => {
  await page.goto("/billing");
  await expect(page).toHaveURL(/\/login$/);
});

test("unauthenticated visit to an owner page redirects to /login", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);
});

test("/ sends signed-out users to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("/ sends a signed-in cashier to /billing and a signed-in owner to /dashboard", async ({ browser }) => {
  const cashierCtx = await browser.newContext();
  const cashier = await cashierCtx.newPage();
  await login(cashier, shop.cashier.username, shop.cashier.password);
  await expect(cashier).toHaveURL(/\/billing$/);
  await cashier.goto("/");
  await expect(cashier).toHaveURL(/\/billing$/);
  await cashierCtx.close();

  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, shop.owner.username, shop.owner.password);
  await expect(owner).toHaveURL(/\/dashboard$/);
  await owner.goto("/");
  await expect(owner).toHaveURL(/\/dashboard$/);
  await ownerCtx.close();
});

test("cashier sees only Billing and Bills", async ({ page }) => {
  await login(page, shop.cashier.username, shop.cashier.password);
  await expect(page).toHaveURL(/\/billing$/);
  expect(await navLabels(page)).toEqual(["Billing", "Bills"]);
  await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
});

test("cashier is redirected away from owner-only pages", async ({ page }) => {
  await login(page, shop.cashier.username, shop.cashier.password);
  await expect(page).toHaveURL(/\/billing$/);
  for (const path of OWNER_ONLY) {
    await page.goto(`/${path}`);
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
  }
});

test("cashier can open Bills", async ({ page }) => {
  await login(page, shop.cashier.username, shop.cashier.password);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Bills" }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByRole("heading", { level: 1, name: "Bills" })).toBeVisible();
});

test("owner sees all six items and can open every page", async ({ page }) => {
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await navLabels(page)).toEqual(OWNER_LABELS);

  for (const label of OWNER_LABELS) {
    const href = `/${label.toLowerCase()}`;
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("nav links are at least 44px tall", async ({ page }) => {
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
  const count = await links.count();
  expect(count).toBe(6);
  for (let i = 0; i < count; i++) {
    const box = await links.nth(i).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const logout = await page.getByRole("button", { name: "Logout" }).boundingBox();
  expect(logout!.height).toBeGreaterThanOrEqual(44);
});

test("Logout clears the session and protects the app again", async ({ page, context }) => {
  await login(page, shop.cashier.username, shop.cashier.password);
  await expect(page).toHaveURL(/\/billing$/);
  expect((await context.cookies()).some((c) => c.name === "session")).toBe(true);

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some((c) => c.name === "session")).toBe(false);

  await page.goto("/billing");
  await expect(page).toHaveURL(/\/login$/);
});
