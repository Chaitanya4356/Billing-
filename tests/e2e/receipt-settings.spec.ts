import { expect, test, type Page } from "@playwright/test";
import type { TestShop } from "../helpers/db";
import { countBills, installPrintHook, login, printed, resetAndSeed } from "./helpers";

let shop: TestShop;

test.beforeAll(async () => {
  shop = await resetAndSeed();
});

async function openReceiptTab(page: Page): Promise<void> {
  await installPrintHook(page);
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings");
  await page.getByRole("link", { name: "Receipt", exact: true }).click();
  await expect(page).toHaveURL(/tab=receipt/);
  await expect(page.getByLabel("Receipt footer")).toBeVisible();
}

/** The document currently rendered inside the preview iframe. */
async function previewDocument(page: Page): Promise<string> {
  const handle = await page.locator('iframe[title="Receipt preview"]').elementHandle();
  const frame = await handle?.contentFrame();
  return frame ? frame.content() : "";
}

test("preview follows the paper width and header without saving; Test Print prints a sample only", async ({ page }) => {
  await openReceiptTab(page);

  const saveRequests: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") saveRequests.push(r.url());
  });

  // Default is 80 mm.
  await expect(page.getByLabel("Paper width")).toHaveValue("80");
  await expect.poll(() => previewDocument(page)).toContain("size: 80mm");
  expect(await previewDocument(page)).toContain("TEST PRINT - NOT A BILL");

  await page.getByLabel("Paper width").selectOption("58");
  await expect.poll(() => previewDocument(page)).toContain("size: 58mm");

  await page.getByLabel("Receipt header").fill("Fresh tea every morning");
  await expect.poll(() => previewDocument(page)).toContain("Fresh tea every morning");

  // Nothing printed and nothing saved so far.
  expect(await printed(page)).toEqual([]);
  expect(saveRequests).toEqual([]);

  await page.getByRole("button", { name: "Test Print" }).click();
  await expect.poll(async () => (await printed(page)).length).toBe(1);
  const [html] = await printed(page);
  expect(html).toContain("TEST PRINT - NOT A BILL");
  expect(html).toContain("size: 58mm");
  expect(html).toContain("Fresh tea every morning");
  expect(html).not.toContain("REPRINT");

  // Test Print sends nothing to the server and creates no bill.
  expect(saveRequests).toEqual([]);
  expect(await countBills(shop.shopId)).toBe(0);
  expect(await printed(page)).toHaveLength(1);

  // The edits were never saved: a reload shows the stored values again.
  await page.reload();
  await expect(page.getByLabel("Paper width")).toHaveValue("80");
  await expect(page.getByLabel("Receipt header")).toHaveValue("");
});

test("Save persists the paper width", async ({ page }) => {
  await openReceiptTab(page);
  await page.getByLabel("Paper width").selectOption("58");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.reload();
  await expect(page.getByLabel("Paper width")).toHaveValue("58");
  await expect.poll(() => previewDocument(page)).toContain("size: 58mm");
  expect(await countBills(shop.shopId)).toBe(0);
});
