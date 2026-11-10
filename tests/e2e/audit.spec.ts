import { expect, test, type Page } from "@playwright/test";
import type { TestShop } from "../helpers/db";
import { chargeCashBill, login, resetAndSeed } from "./helpers";

let shop: TestShop;

test.beforeAll(async () => {
  shop = await resetAndSeed();
});

const auditTable = (page: Page) => page.getByRole("table", { name: "Audit log, newest first" });
const dataRows = (page: Page) => auditTable(page).locator("tbody tr");

test.describe.configure({ mode: "serial" });

test("events made through the UI show up in the audit log, newest first with readable labels", async ({ page }) => {
  // 1. A cashier signs in with a wrong password.
  await login(page, shop.cashier.username, "definitely-wrong-password");
  await expect(page.getByText("Invalid username or password")).toBeVisible();

  // 2. The owner signs in, renames the shop...
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings");
  await page.getByLabel("Shop name").fill("Audit Chai Point");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  // 3. ...and charges a bill.
  await page.goto("/billing");
  await chargeCashBill(page, [{ name: "Masala Tea", qty: 1 }]);

  // The owner opens Settings > Audit log through the tab link.
  await page.goto("/settings");
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page).toHaveURL(/tab=audit/);
  await expect(auditTable(page)).toBeVisible();

  // Newest first: bill created, settings changed, login failed.
  const labels = await dataRows(page).evaluateAll((rows) =>
    rows.map((r) => r.querySelectorAll("td")[2]?.textContent?.trim() ?? ""),
  );
  const iBill = labels.indexOf("Bill created");
  const iSettings = labels.indexOf("Settings changed");
  const iLogin = labels.indexOf("Login failed");
  expect(iBill).toBeGreaterThanOrEqual(0);
  expect(iSettings).toBeGreaterThan(iBill);
  expect(iLogin).toBeGreaterThan(iSettings);

  // Readable content: the user's name, the entity and the details.
  const billRow = dataRows(page).nth(iBill);
  await expect(billRow).toContainText("Test Owner");
  await expect(billRow).toContainText("bill");
  await expect(billRow).toContainText("totalPaise: 1500");
  await expect(billRow).toContainText("paymentMethod: CASH");
  await expect(dataRows(page).nth(iLogin)).toContainText("username: cashier");

  // The tab is read-only: no buttons inside the table.
  await expect(auditTable(page).getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("audit-page-range")).toHaveText(`1–${labels.length} of ${labels.length}`);
  await expect(page.getByRole("link", { name: "Next" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Prev" })).toHaveCount(0);
});

test("the action filter narrows the list to one action, and Clear brings everything back", async ({ page }) => {
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings?tab=audit");
  const all = await dataRows(page).count();
  expect(all).toBeGreaterThanOrEqual(3);

  await page.getByLabel("Action").selectOption("SETTINGS_CHANGED");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/action=SETTINGS_CHANGED/);
  await expect(page).toHaveURL(/tab=audit/);
  await expect(dataRows(page)).toHaveCount(1);
  await expect(dataRows(page).first()).toContainText("Settings changed");
  await expect(page.getByLabel("Action")).toHaveValue("SETTINGS_CHANGED");

  // An action with no rows shows the empty state.
  await page.getByLabel("Action").selectOption("BILL_CANCELLED");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No audit entries found.")).toBeVisible();
  await expect(page.getByTestId("audit-page-range")).toHaveText("0 of 0");

  await page.getByRole("link", { name: "Clear" }).click();
  await expect(dataRows(page)).toHaveCount(all);
});

test("a date range in the past shows no rows; one reaching the present shows them all", async ({ page }) => {
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings?tab=audit");
  const all = await dataRows(page).count();

  // 2020-01-01 is long before any row; the range up to today includes everything.
  await page.getByLabel("From date").fill("2020-01-01");
  await page.getByLabel("To date").fill("2020-01-02");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No audit entries found.")).toBeVisible();

  await page.getByLabel("To date").fill("2099-12-31");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(dataRows(page)).toHaveCount(all);
});

test("bad URL parameters render the default page without an error", async ({ page }) => {
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  for (const qs of [
    "from=garbage",
    "to=2026-02-30",
    "from=2026-11-11&to=2026-11-10",
    "action=NOT_REAL",
    "page=0",
    "page=abc",
    "page=999999",
    "action=BILL_CREATED&action=x",
  ]) {
    const response = await page.goto(`/settings?tab=audit&${qs}`);
    expect(response?.status(), qs).toBe(200);
    await expect(page.getByRole("heading", { name: "Settings" }), qs).toBeVisible();
    await expect(page.getByLabel("From date"), qs).toBeVisible();
    await expect(page.locator("p[role=alert]"), qs).toHaveCount(0);
  }

  // Garbage filters fall back to the unfiltered list.
  await page.goto("/settings?tab=audit&from=garbage&action=NOT_REAL");
  await expect(dataRows(page).first()).toBeVisible();
  await expect(page.getByLabel("From date")).toHaveValue("");
  await expect(page.getByLabel("Action")).toHaveValue("");
});

test("a cashier cannot reach the audit log", async ({ page }) => {
  await login(page, shop.cashier.username, shop.cashier.password);
  await expect(page).toHaveURL(/\/billing$/);
  await page.goto("/settings?tab=audit");
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByRole("table", { name: "Audit log, newest first" })).toHaveCount(0);
});
