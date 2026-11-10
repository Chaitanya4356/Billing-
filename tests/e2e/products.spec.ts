import { expect, test, type Page } from "@playwright/test";
import type { TestShop } from "../helpers/db";
import { login, resetAndSeed } from "./helpers";

// The tests build on each other (category and product created in the first one),
// and a failure restarts the worker and reseeds, so run them as one serial group.
test.describe.configure({ mode: "serial" });

let shop: TestShop;

test.beforeAll(async () => {
  shop = await resetAndSeed();
});

async function openProducts(page: Page): Promise<void> {
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
}

/** Opens the Tea category and waits until its products are on screen. */
async function selectTea(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Tea", exact: true }).click();
  await expect(page).toHaveURL(/category=/);
  await expect(page.getByRole("region", { name: "Products in Tea" })).toBeVisible();
}

test("owner adds category Tea and product Masala Tea; it lists with its price and can be disabled", async ({
  page,
}) => {
  await openProducts(page);

  await page.getByLabel("New category name").fill("Tea");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByRole("link", { name: "Tea", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/category=/);

  await page.getByRole("button", { name: "Add product" }).click();
  const dialog = page.getByRole("dialog", { name: "Add product" });
  await dialog.getByLabel("Product name").fill("Masala Tea");
  await dialog.getByLabel("Price (₹)").fill("15");
  await dialog.getByLabel("Short code (optional)").fill("MT");
  await dialog.getByRole("button", { name: "Save product" }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("row", { name: /Masala Tea/ });
  await expect(row).toContainText("₹15.00");
  await expect(row).toContainText("MT");

  const toggle = page.getByRole("switch", { name: "Product Masala Tea enabled" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();

  await page.reload();
  await expect(page.getByRole("row", { name: /Masala Tea/ })).toContainText("₹15.00");
  await expect(page.getByRole("switch", { name: "Product Masala Tea enabled" })).not.toBeChecked();

  await page.getByRole("switch", { name: "Product Masala Tea enabled" }).click();
  await expect(page.getByRole("switch", { name: "Product Masala Tea enabled" })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Product Masala Tea enabled" })).toBeChecked();
});

test("blank or invalid price shows an inline error and submits nothing; 0 is allowed", async ({ page }) => {
  await openProducts(page);
  await selectTea(page);

  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });

  await page.getByRole("button", { name: "Add product" }).click();
  const dialog = page.getByRole("dialog", { name: "Add product" });
  await dialog.getByLabel("Product name").fill("Water");

  await dialog.getByRole("button", { name: "Save product" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a price");

  await dialog.getByLabel("Price (₹)").fill("12.345");
  await dialog.getByRole("button", { name: "Save product" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a price");

  await dialog.getByLabel("Price (₹)").fill("abc");
  await dialog.getByRole("button", { name: "Save product" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a price");
  expect(posts).toEqual([]);

  await dialog.getByLabel("Price (₹)").fill("0");
  await dialog.getByRole("button", { name: "Save product" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: /Water/ })).toContainText("₹0.00");
});

test("owner edits a product's name and price", async ({ page }) => {
  await openProducts(page);
  await selectTea(page);

  await page.getByRole("button", { name: "Edit Masala Tea" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit product" });
  await expect(dialog.getByLabel("Product name")).toHaveValue("Masala Tea");
  await expect(dialog.getByLabel("Price (₹)")).toHaveValue("15");
  await dialog.getByLabel("Product name").fill("Ginger Tea");
  await dialog.getByLabel("Price (₹)").fill("17.5");
  await dialog.getByRole("button", { name: "Save product" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("row", { name: /Ginger Tea/ })).toContainText("₹17.50");
  await expect(page.getByRole("row", { name: /Masala Tea/ })).toHaveCount(0);
});

test("duplicate category names show an inline error; a category can be renamed and deactivated", async ({
  page,
}) => {
  await openProducts(page);

  await page.getByLabel("New category name").fill("tea");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("already exists");

  await page.getByRole("button", { name: "Rename Tea" }).click();
  await page.getByLabel("Category name", { exact: true }).fill("Hot Drinks");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("link", { name: "Hot Drinks", exact: true })).toBeVisible();

  const toggle = page.getByRole("switch", { name: "Category Hot Drinks active" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Category Hot Drinks active" })).not.toBeChecked();
});

test("owner deletes a product after confirming; it disappears from the list", async ({ page }) => {
  await openProducts(page);
  await page.getByRole("link", { name: "Hot Drinks", exact: true }).click();
  await expect(page.getByRole("region", { name: "Products in Hot Drinks" })).toBeVisible();

  await page.getByRole("button", { name: "Edit Water" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit product" });
  await dialog.getByRole("button", { name: "Delete product" }).click();
  await dialog.getByRole("button", { name: "Keep product" }).click();
  await expect(page.getByRole("row", { name: /Water/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Delete product" }).click();
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: /Water/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("row", { name: /Water/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Ginger Tea/ })).toHaveCount(1);
});

test("the cashier cannot open the products page", async ({ page }) => {
  await login(page, shop.cashier.username, shop.cashier.password);
  await expect(page).toHaveURL(/\/billing$/);
  await page.goto("/products");
  await expect(page).toHaveURL(/\/billing$/);
});
