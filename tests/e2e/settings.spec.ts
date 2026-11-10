import { expect, test, type Page } from "@playwright/test";
import type { TestShop } from "../helpers/db";
import { login, resetAndSeed } from "./helpers";

let shop: TestShop;

test.beforeAll(async () => {
  shop = await resetAndSeed();
});

async function loginAsOwner(page: Page): Promise<void> {
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("owner changes shop name and GST rate; values persist after reload", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/settings");
  await page.getByLabel("Shop name").fill("Chai Point");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.getByRole("link", { name: "GST" }).click();
  await expect(page).toHaveURL(/tab=gst/);
  await page.getByLabel("Charge GST on bills").check();
  await page.getByLabel("GST rate (%)").fill("18");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.reload();
  await expect(page.getByLabel("GST rate (%)")).toHaveValue("18");
  await expect(page.getByLabel("Charge GST on bills")).toBeChecked();
  await page.getByRole("link", { name: "Shop", exact: true }).click();
  await expect(page.getByLabel("Shop name")).toHaveValue("Chai Point");
  await page.reload();
  await expect(page.getByLabel("Shop name")).toHaveValue("Chai Point");
});

test("GST rate 0 is accepted and persists", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/settings?tab=gst");
  await page.getByLabel("GST rate (%)").fill("0");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByLabel("GST rate (%)")).toHaveValue("0");
});

test("invalid GST rate and discount limit show inline errors and are not submitted", async ({ page }) => {
  await loginAsOwner(page);

  const saveRequests: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/settings")) saveRequests.push(r.url());
  });

  await page.goto("/settings?tab=gst");
  await page.getByLabel("GST rate (%)").fill("abc");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Enter a rate");
  await page.getByLabel("GST rate (%)").fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Enter a rate");
  await page.getByLabel("GST rate (%)").fill("101");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Enter a rate");

  await page.goto("/settings?tab=discounts");
  await page.getByLabel("Cashier flat discount limit (₹)").fill("12.345");
  await page.getByLabel("Cashier percent discount limit (%)").fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("p[role=alert]")).toHaveCount(2);

  expect(saveRequests).toEqual([]);

  // A valid zero limit is accepted and shows as 0 after reload.
  await page.getByLabel("Cashier flat discount limit (₹)").fill("0");
  await page.getByLabel("Cashier percent discount limit (%)").fill("0");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByLabel("Cashier flat discount limit (₹)")).toHaveValue("0");
  await expect(page.getByLabel("Cashier percent discount limit (%)")).toHaveValue("0");
});

test("discount limits are stored as paise and basis points", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/settings?tab=discounts");
  await page.getByLabel("Cashier flat discount limit (₹)").fill("₹1,250.5");
  await page.getByLabel("Cashier percent discount limit (%)").fill("12.5");
  await page.getByLabel("Cashiers can cancel bills").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByLabel("Cashier flat discount limit (₹)")).toHaveValue("1250.5");
  await expect(page.getByLabel("Cashier percent discount limit (%)")).toHaveValue("12.5");
  await expect(page.getByLabel("Cashiers can cancel bills")).toBeChecked();
});

test("a bad GSTIN and bill prefix show inline errors", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/settings?tab=shop");
  await page.getByLabel("GSTIN").fill("NOTAGSTIN");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("GSTIN");

  await page.goto("/settings?tab=numbering");
  await page.getByLabel("Bill prefix").fill("A-1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Bill prefix");
});

test("all tabs render and the cashier cannot open settings", async ({ page, browser }) => {
  await loginAsOwner(page);
  await page.goto("/settings");
  for (const [name, label] of [
    ["Shop", "Shop name"],
    ["Numbering", "Bill prefix"],
    ["GST", "GST rate (%)"],
    ["Discounts", "Cashier flat discount limit (₹)"],
    ["Receipt", "Receipt footer"],
  ] as const) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByLabel(label)).toBeVisible();
  }

  const cashierCtx = await browser.newContext();
  const cashier = await cashierCtx.newPage();
  await login(cashier, shop.cashier.username, shop.cashier.password);
  await expect(cashier).toHaveURL(/\/billing$/);
  await cashier.goto("/settings");
  await expect(cashier).toHaveURL(/\/billing$/);
  await cashierCtx.close();
});
