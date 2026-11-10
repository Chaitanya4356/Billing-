import { expect, test, type Page } from "@playwright/test";
import type { TestShop } from "../helpers/db";
import { login, resetAndSeed } from "./helpers";

let shop: TestShop;

test.beforeAll(async () => {
  shop = await resetAndSeed();
});

async function openUsersTabAsOwner(page: Page, password = shop.owner.password): Promise<void> {
  await login(page, shop.owner.username, password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings?tab=users");
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
}

const userRow = (page: Page, username: string) =>
  page.getByRole("table", { name: "Users" }).locator(`tr[data-username="${username}"]`);

async function createCashierViaUi(page: Page, name: string, username: string, password: string): Promise<void> {
  const form = page.getByRole("form", { name: "Create cashier" });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Username").fill(username);
  await form.getByLabel("Password", { exact: true }).fill(password);
  await form.getByRole("button", { name: "Create cashier" }).click();
  await expect(form.getByRole("status")).toHaveText(`Cashier ${username} created`);
  await expect(userRow(page, username)).toContainText("Active");
}

test.describe.configure({ mode: "serial" });

test("owner creates a cashier who signs in; after deactivation their next page load goes to /login", async ({
  page,
  browser,
}) => {
  await openUsersTabAsOwner(page);
  // The owner row has no management buttons.
  await expect(userRow(page, "owner").getByRole("button")).toHaveCount(0);
  await expect(userRow(page, "owner")).toContainText("Owner");

  await createCashierViaUi(page, "Ravi Kumar", "ravi", "ravi-pass-123");
  // The password field is cleared after creating.
  await expect(page.getByRole("form", { name: "Create cashier" }).getByLabel("Password", { exact: true })).toHaveValue("");

  const cashierContext = await browser.newContext();
  const cashierPage = await cashierContext.newPage();
  try {
    await login(cashierPage, "ravi", "ravi-pass-123");
    await expect(cashierPage).toHaveURL(/\/billing$/);
    await expect(cashierPage.getByRole("searchbox", { name: "Search products" })).toBeVisible();

    const row = userRow(page, "ravi");
    await row.getByRole("button", { name: "Deactivate ravi" }).click();
    await row.getByRole("button", { name: "Confirm deactivate" }).click();
    await expect(row.getByRole("status")).toHaveText("ravi deactivated and signed out");
    await expect(row).toContainText("Inactive");
    await expect(row.getByRole("button", { name: "Reactivate ravi" })).toBeVisible();

    await cashierPage.reload();
    await expect(cashierPage).toHaveURL(/\/login$/);
    await login(cashierPage, "ravi", "ravi-pass-123");
    await expect(cashierPage.getByText("Invalid username or password")).toBeVisible();
  } finally {
    await cashierContext.close();
  }
});

test("owner resets a cashier's password: the new one works and the old one does not", async ({ page, browser }) => {
  await openUsersTabAsOwner(page);
  const row = userRow(page, shop.cashier.username);
  await row.getByRole("button", { name: `Reset password for ${shop.cashier.username}` }).click();

  // Too short: inline error, nothing sent.
  const field = row.getByLabel(`New password for ${shop.cashier.username}`);
  await field.fill("short");
  await row.getByRole("button", { name: "Set new password" }).click();
  await expect(row.getByRole("alert")).toContainText("at least 8 characters");

  await field.fill("reset-pass-789");
  await row.getByRole("button", { name: "Set new password" }).click();
  await expect(row.getByRole("status")).toContainText(`Password reset for ${shop.cashier.username}`);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  try {
    await login(other, shop.cashier.username, shop.cashier.password);
    await expect(other.getByText("Invalid username or password")).toBeVisible();
    await expect(other).toHaveURL(/\/login$/);
    await login(other, shop.cashier.username, "reset-pass-789");
    await expect(other).toHaveURL(/\/billing$/);
  } finally {
    await ctx.close();
  }
});

test("owner changes their own password, is sent to /login and the new password works", async ({ page }) => {
  await openUsersTabAsOwner(page);
  const form = page.getByRole("form", { name: "Change my password" });

  await form.getByLabel("Current password").fill("not-the-password");
  await form.getByLabel("New password", { exact: true }).fill("owner-new-pass-1");
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("alert")).toHaveText("Current password is incorrect");
  await expect(page).toHaveURL(/tab=users/);

  await form.getByLabel("Current password").fill(shop.owner.password);
  await form.getByLabel("New password", { exact: true }).fill("owner-new-pass-1");
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The old session is gone: a protected page sends us back to /login.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, shop.owner.username, shop.owner.password);
  await expect(page.getByText("Invalid username or password")).toBeVisible();
  await openUsersTabAsOwner(page, "owner-new-pass-1");
});
