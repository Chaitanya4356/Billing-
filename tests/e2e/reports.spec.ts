import { expect, test, type Page } from "@playwright/test";
import { cancelBillViaUi, chargeCashBill, chargeUpiBill, login, openBillingAs, resetAndSeed, type SeededShop } from "./helpers";

// One fresh database; the tests build on each other.
test.describe.configure({ mode: "serial" });

type Bill = { token: string; billNumber: string };

const stat = (page: Page, id: string) => page.getByTestId(id);

/** Signs in as the owner and waits for the dashboard, so the next navigation cannot cut the sign-in short. */
async function loginAsOwner(page: Page, owner: { username: string; password: string }): Promise<void> {
  await login(page, owner.username, owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("dashboard, reports and CSV export", () => {
  let shop: SeededShop;
  let cash: Bill;
  let upi: Bill;
  let cancelled: Bill;

  test.beforeAll(async () => {
    shop = await resetAndSeed();
  });

  test("setup: a cash bill, a UPI bill and a third bill the owner cancels", async ({ page }) => {
    await openBillingAs(page, shop.owner, "OWNER");
    cash = await chargeCashBill(page, [
      { name: "Masala Tea", qty: 2 },
      { name: "Samosa", qty: 1 },
    ]);
    upi = await chargeUpiBill(page, [{ name: "Masala Tea", qty: 2 }]);
    cancelled = await chargeCashBill(page, [{ name: "Samosa", qty: 1 }]);
    await cancelBillViaUi(page, cancelled.billNumber, "Customer changed their mind");
  });

  test("the dashboard shows today's sales and the recent bills", async ({ page }) => {
    await loginAsOwner(page, shop.owner);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(stat(page, "stat-total")).toHaveText("₹75.00");
    await expect(stat(page, "stat-bills")).toHaveText("2");
    await expect(stat(page, "stat-cash")).toHaveText("₹45.00");
    await expect(stat(page, "stat-upi")).toHaveText("₹30.00");
    await expect(stat(page, "stat-cancelled")).toHaveText("1");
    await expect(stat(page, "stat-cancelled-amount")).toHaveText("₹15.00");

    const table = page.getByRole("table", { name: "Recent bills" });
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: cash.billNumber })).toContainText("Cash");
    await expect(rows.filter({ hasText: cash.billNumber })).toContainText("COMPLETED");
    await expect(rows.filter({ hasText: cash.billNumber })).toContainText("₹45.00");
    await expect(rows.filter({ hasText: upi.billNumber })).toContainText("UPI");
    await expect(rows.filter({ hasText: upi.billNumber })).toContainText("₹30.00");
    await expect(rows.filter({ hasText: cancelled.billNumber })).toContainText("CANCELLED");
    await expect(rows.filter({ hasText: cancelled.billNumber })).toContainText("₹15.00");
    // Newest first.
    await expect(rows.first()).toContainText(cancelled.billNumber);
    await expect(rows.last()).toContainText(cash.billNumber);
  });

  test("the Reports Day tab shows the same figures, per-day rows and top items", async ({ page }) => {
    await loginAsOwner(page, shop.owner);
    await page.goto("/reports");
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Week", exact: true })).not.toHaveAttribute("aria-current", "page");

    await expect(stat(page, "stat-gross")).toHaveText("₹75.00");
    await expect(stat(page, "stat-discounts")).toHaveText("₹0.00");
    await expect(stat(page, "stat-gst")).toHaveText("₹0.00");
    await expect(stat(page, "stat-net-total")).toHaveText("₹75.00");
    await expect(stat(page, "stat-bills")).toHaveText("2");
    await expect(stat(page, "stat-average")).toHaveText("₹37.50");
    await expect(stat(page, "stat-cash")).toHaveText("₹45.00");
    await expect(stat(page, "stat-upi")).toHaveText("₹30.00");
    await expect(stat(page, "stat-cancelled")).toHaveText("1");
    await expect(stat(page, "stat-cancelled-amount")).toHaveText("₹15.00");
    await expect(page.getByText(/excluded from sales/i)).toBeVisible();

    const daily = page.getByRole("table", { name: "Sales by day" });
    await expect(daily.locator("tbody tr")).toHaveCount(1);
    await expect(daily.locator("tbody tr")).toContainText("₹75.00");
    await expect(daily.locator("tfoot tr")).toContainText("Total");
    await expect(daily.locator("tfoot tr")).toContainText("₹75.00");

    const top = page.getByRole("table", { name: "Top items" }).locator("tbody tr");
    await expect(top).toHaveCount(2);
    await expect(top.nth(0)).toContainText("Masala Tea");
    await expect(top.nth(0)).toContainText("4");
    await expect(top.nth(0)).toContainText("₹60.00");
    await expect(top.nth(1)).toContainText("Samosa");
    await expect(top.nth(1)).toContainText("1");
    await expect(top.nth(1)).toContainText("₹15.00");
  });

  test("the Week and Month tabs show the same sales", async ({ page }) => {
    await loginAsOwner(page, shop.owner);
    await page.goto("/reports");
    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/period=week/);
    await expect(page.getByRole("link", { name: "Week", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(stat(page, "stat-net-total")).toHaveText("₹75.00");
    await expect(stat(page, "stat-bills")).toHaveText("2");

    await page.getByRole("link", { name: "Month", exact: true }).click();
    await expect(page).toHaveURL(/period=month/);
    await expect(page.getByRole("link", { name: "Month", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(stat(page, "stat-net-total")).toHaveText("₹75.00");
    await expect(page.getByRole("table", { name: "Sales by day" }).locator("tbody tr")).toHaveCount(1);
  });

  test("the date picker picks the anchor day", async ({ page }) => {
    await loginAsOwner(page, shop.owner);
    await page.goto("/reports?period=day&date=2020-01-15");
    await expect(stat(page, "stat-net-total")).toHaveText("₹0.00");
    await expect(stat(page, "stat-bills")).toHaveText("0");
    await expect(page.getByLabel("Date")).toHaveValue("2020-01-15");
    await expect(page.getByText("No sales in this period.")).toBeVisible();

    await page.getByLabel("Date").fill("2020-02-01");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/period=day&date=2020-02-01/);
    await expect(page.getByLabel("Date")).toHaveValue("2020-02-01");
  });

  test("hand-edited period and date fall back to today's day report", async ({ page }) => {
    await loginAsOwner(page, shop.owner);
    await page.goto("/reports?period=zzz&date=garbage");
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(stat(page, "stat-net-total")).toHaveText("₹75.00");

    await page.goto("/reports?period=week&date=2026-02-30");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Week", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(stat(page, "stat-net-total")).toHaveText("₹75.00");
  });

  test("the owner downloads the CSV with every bill and a summary", async ({ page }) => {
    await loginAsOwner(page, shop.owner);
    await page.goto("/reports");
    const link = page.getByRole("link", { name: "Export CSV" });
    await expect(link).toHaveAttribute("href", /^\/reports\/export\?period=day&date=\d{4}-\d{2}-\d{2}$/);

    const res = await page.request.get("/reports/export?period=day");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers()["content-disposition"]).toMatch(
      /^attachment; filename="sales-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.text();
    expect(body).toContain("Date,Bill No,Token,Status,Subtotal,Discount,GST,Total,Payment Method");
    for (const b of [cash, upi, cancelled]) expect(body).toContain(b.billNumber);
    const cancelledRow = body.split("\r\n").find((l) => l.includes(cancelled.billNumber));
    expect(cancelledRow).toContain("CANCELLED");
    expect(cancelledRow).toContain("15.00");
    expect(body).toContain("Net total,75.00");
    expect(body).toContain("Cancelled bills,1");

    // The link itself downloads that file.
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toMatch(/^sales-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);

    // Bad parameters are refused, not crashed.
    const bad = await page.request.get("/reports/export?period=zzz&date=garbage");
    expect(bad.status()).toBe(400);
    const badDate = await page.request.get("/reports/export?period=day&date=2026-02-30");
    expect(badDate.status()).toBe(400);
  });

  test("a cashier and an anonymous visitor cannot export or open the owner pages", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const anon = await playwright.request.newContext({ baseURL });
    const anonRes = await anon.get("/reports/export?period=day", { maxRedirects: 0 });
    expect(anonRes.status()).toBe(401);
    expect(anonRes.headers()["content-type"]).not.toContain("text/csv");
    await anon.dispose();

    await login(page, shop.cashier.username, shop.cashier.password);
    await expect(page).toHaveURL(/\/billing$/);
    const res = await page.request.get("/reports/export?period=day", { maxRedirects: 0 });
    expect(res.status()).toBe(403);
    expect(res.headers()["content-type"]).not.toContain("text/csv");
    expect(await res.text()).not.toContain(cash.billNumber);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/billing$/);
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/billing$/);
  });
});
