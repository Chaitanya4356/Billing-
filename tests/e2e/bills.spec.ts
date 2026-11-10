import { expect, test, type Page } from "@playwright/test";
import {
  chargeCashBill,
  countBills,
  installPrintHook,
  login,
  moveBillBusinessDateBack,
  openBillingAs,
  printed,
  resetAndSeed,
  setCashierCanCancel,
  type SeededShop,
} from "./helpers";

// Every group starts from a fresh database (tokens and bill numbers restart at
// 1), and the tests inside a group build on each other.
test.describe.configure({ mode: "serial" });

const billsTable = (page: Page) => page.getByRole("table", { name: "Bills" });
const rows = (page: Page) => billsTable(page).locator("tbody tr");
const rowFor = (page: Page, billNumber: string) => rows(page).filter({ hasText: billNumber });
const drawer = (page: Page, billNumber: string) => page.getByRole("dialog", { name: `Bill ${billNumber}` });
const searchBox = (page: Page) => page.getByLabel("Search token or bill number");

async function openBillsAs(page: Page, user: { username: string; password: string }): Promise<void> {
  await installPrintHook(page);
  await login(page, user.username, user.password);
  await expect(page).toHaveURL(/\/(dashboard|billing)$/);
  await page.goto("/bills");
  await expect(billsTable(page)).toBeVisible();
}

async function search(page: Page, text: string): Promise<void> {
  await searchBox(page).fill(text);
  await searchBox(page).press("Enter");
}

test.describe("bill history: search, detail, reprint, cancel", () => {
  let shop: SeededShop;
  let b1: { token: string; billNumber: string };
  let b2: { token: string; billNumber: string };

  test.beforeAll(async () => {
    shop = await resetAndSeed();
  });

  test("setup: a cashier charges two cash bills", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    // The first bill is printed once from the success screen, so a later print is a REPRINT.
    b1 = await chargeCashBill(page, [{ name: "Masala Tea", qty: 2 }], { print: true });
    b2 = await chargeCashBill(page, [{ name: "Samosa", qty: 1 }, { name: "Masala Tea", qty: 1 }]);
    expect(b1.token).toBe("1");
    expect(b2.token).toBe("2");
    expect(await countBills(shop.shopId)).toBe(2);
  });

  test("searching a token number or a bill number finds that bill", async ({ page }) => {
    await openBillsAs(page, shop.owner);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByTestId("page-range")).toHaveText("1–2 of 2");

    await search(page, b2.token);
    await expect(page).toHaveURL(/q=2/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rowFor(page, b2.billNumber)).toHaveCount(1);

    await search(page, b1.billNumber);
    await expect(rows(page)).toHaveCount(1);
    await expect(rowFor(page, b1.billNumber)).toHaveCount(1);
    await expect(page.getByTestId("page-range")).toHaveText("1–1 of 1");

    await search(page, "999");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText("No bills found")).toBeVisible();

    await search(page, "");
    await expect(rows(page)).toHaveCount(2);
  });

  test("opening a bill shows its items, payment and total", async ({ page }) => {
    await openBillsAs(page, shop.owner);
    await rowFor(page, b1.billNumber).click();
    const d = drawer(page, b1.billNumber);
    await expect(d).toBeVisible();
    await expect(d.getByText("Masala Tea")).toBeVisible();
    const item = d.getByRole("row").filter({ hasText: "Masala Tea" });
    await expect(item).toContainText("2");
    await expect(item).toContainText("₹15.00");
    await expect(item).toContainText("₹30.00");
    await expect(d.getByTestId("bill-total")).toHaveText("₹30.00");
    await expect(d.getByTestId("bill-payment-method")).toHaveText("Cash");
    await expect(d.getByTestId("bill-tendered")).toHaveText("₹30.00");
    await expect(d.getByTestId("bill-print-count")).toHaveText("1");
    await expect(d.getByRole("button", { name: "Reprint" })).toBeVisible();

    await d.getByRole("button", { name: "Close" }).click();
    await expect(d).toBeHidden();
  });

  test("Reprint sends a REPRINT receipt with the bill's token and consumes no token", async ({ page }) => {
    await openBillsAs(page, shop.owner);
    await rowFor(page, b1.billNumber).click();
    const d = drawer(page, b1.billNumber);
    await expect(d.getByTestId("bill-print-count")).toHaveText("1");

    // Opening a bill never prints.
    expect(await printed(page)).toEqual([]);

    await d.getByRole("button", { name: "Reprint" }).click();
    await expect.poll(async () => (await printed(page)).length).toBe(1);
    const [html] = await printed(page);
    expect(html).toContain("REPRINT");
    expect(html).toContain(`<div class="token">${b1.token}</div>`);
    await expect(d.getByTestId("bill-print-count")).toHaveText("2");
    await expect(d.getByRole("button", { name: "Reprint" })).toBeEnabled();

    // The bills and their tokens are unchanged.
    expect(await countBills(shop.shopId)).toBe(2);
    await d.getByRole("button", { name: "Close" }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(rowFor(page, b1.billNumber)).toContainText(b1.token);
    await expect(rowFor(page, b2.billNumber)).toContainText(b2.token);
  });

  test("the next bill continues the token sequence (a reprint consumed none)", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    const b3 = await chargeCashBill(page, [{ name: "Samosa", qty: 2 }]);
    expect(b3.token).toBe("3");
    expect(b3.billNumber).toMatch(/-000003$/);
    expect(await countBills(shop.shopId)).toBe(3);
  });

  test("the owner cancels a bill with a reason; the row stays listed as CANCELLED", async ({ page }) => {
    await openBillsAs(page, shop.owner);
    await expect(rows(page)).toHaveCount(3);
    await rowFor(page, b2.billNumber).click();
    const d = drawer(page, b2.billNumber);
    await expect(d.getByTestId("bill-status")).toHaveText("COMPLETED");
    await d.getByRole("button", { name: "Cancel bill" }).click();

    const dialog = page.getByRole("dialog", { name: "Cancel this bill?" });
    await expect(dialog).toBeVisible();
    const reason = dialog.getByLabel("Reason for cancelling");

    // Invalid reasons are rejected inline, without calling the server.
    let actionPosts = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actionPosts++;
    });
    await dialog.getByRole("button", { name: "Confirm cancel" }).click();
    await expect(dialog.getByRole("alert")).toContainText("at least 3 characters");
    await reason.fill("ab");
    await dialog.getByRole("button", { name: "Confirm cancel" }).click();
    await expect(dialog.getByRole("alert")).toContainText("at least 3 characters");
    await reason.fill("x".repeat(201));
    await dialog.getByRole("button", { name: "Confirm cancel" }).click();
    await expect(dialog.getByRole("alert")).toContainText("at most 200 characters");
    expect(actionPosts).toBe(0);

    // "Keep bill" leaves everything as it was.
    await dialog.getByRole("button", { name: "Keep bill" }).click();
    await expect(dialog).toBeHidden();
    await expect(d.getByTestId("bill-status")).toHaveText("COMPLETED");

    await d.getByRole("button", { name: "Cancel bill" }).click();
    await dialog.getByLabel("Reason for cancelling").fill("Customer changed their mind");
    await dialog.getByRole("button", { name: "Confirm cancel" }).click();
    await expect(dialog).toBeHidden();

    await expect(d.getByTestId("bill-status")).toHaveText("CANCELLED");
    await expect(d.getByText("Customer changed their mind")).toBeVisible();
    await expect(d.getByTestId("bill-cancelled-at")).toBeVisible();
    await expect(d.getByText("VOIDED")).toBeVisible();
    await expect(d.getByRole("button", { name: "Cancel bill" })).toHaveCount(0);

    await d.getByRole("button", { name: "Close" }).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(rowFor(page, b2.billNumber)).toContainText("CANCELLED");
    await expect(rowFor(page, b1.billNumber)).toContainText("COMPLETED");

    // The status filter finds it,.
    await page.getByLabel("Status").selectOption("CANCELLED");
    await expect(rows(page)).toHaveCount(1);
    await expect(page).toHaveURL(/status=CANCELLED/);
  });

  test("a cashier cannot cancel unless the owner enables it; cancelled bills never offer it", async ({ page }) => {
    await openBillsAs(page, shop.cashier);
    await rowFor(page, "-000003").click();
    const d3 = page.getByRole("dialog", { name: /^Bill B-/ });
    await expect(d3.getByTestId("bill-status")).toHaveText("COMPLETED");
    await expect(d3.getByRole("button", { name: "Reprint" })).toBeVisible();
    await expect(d3.getByRole("button", { name: "Cancel bill" })).toHaveCount(0);

    await setCashierCanCancel(shop.shopId, true);
    await page.reload();
    await expect(billsTable(page)).toBeVisible();
    await rowFor(page, "-000003").click();
    await expect(d3.getByRole("button", { name: "Cancel bill" })).toBeVisible();
    await d3.getByRole("button", { name: "Close" }).click();

    // Already cancelled: no Cancel button even though the cashier may cancel.
    await rowFor(page, b2.billNumber).click();
    const d2 = drawer(page, b2.billNumber);
    await expect(d2.getByTestId("bill-status")).toHaveText("CANCELLED");
    await expect(d2.getByRole("button", { name: "Cancel bill" })).toHaveCount(0);
    await setCashierCanCancel(shop.shopId, false);
  });
});

test.describe("bill history: dates", () => {
  let shop: SeededShop;
  let older: { token: string; billNumber: string };
  let today: { token: string; billNumber: string };
  let yesterday: string;

  test.beforeAll(async () => {
    shop = await resetAndSeed();
  });

  test("setup: two bills, one moved to yesterday", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    older = await chargeCashBill(page, [{ name: "Masala Tea", qty: 1 }]);
    today = await chargeCashBill(page, [{ name: "Samosa", qty: 1 }]);
    yesterday = await moveBillBusinessDateBack(shop.shopId, older.billNumber);
    expect(yesterday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("a cashier has no date filter and only sees today's bills", async ({ page }) => {
    await openBillsAs(page, shop.cashier);
    await expect(page.getByLabel("Date")).toHaveCount(0);
    await expect(page.getByLabel("Status")).toBeVisible();
    await expect(page.getByLabel("Payment method")).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect(rowFor(page, today.billNumber)).toHaveCount(1);
    await expect(rowFor(page, older.billNumber)).toHaveCount(0);

    // A date in the URL is ignored for a cashier.
    await page.goto(`/bills?date=${yesterday}`);
    await expect(rows(page)).toHaveCount(1);
    await expect(rowFor(page, today.billNumber)).toHaveCount(1);
  });

  test("the owner's date filter finds the older bill", async ({ page }) => {
    await openBillsAs(page, shop.owner);
    await expect(rows(page)).toHaveCount(2);

    await page.getByLabel("Date").fill(yesterday);
    await expect(page).toHaveURL(new RegExp(`date=${yesterday}`));
    await expect(rows(page)).toHaveCount(1);
    await expect(rowFor(page, older.billNumber)).toHaveCount(1);
    await expect(rowFor(page, today.billNumber)).toHaveCount(0);

    // The method filter combines with it.
    await page.getByLabel("Payment method").selectOption("UPI");
    await expect(rows(page)).toHaveCount(0);
    await page.getByLabel("Payment method").selectOption("CASH");
    await expect(rows(page)).toHaveCount(1);

    await page.getByLabel("Date").fill("");
    await page.getByLabel("Payment method").selectOption("");
    await expect(rows(page)).toHaveCount(2);
  });

  test("paging uses the URL; hand-edited URLs never break the page", async ({ page }) => {
    await openBillsAs(page, shop.owner);
    await expect(page.getByTestId("page-range")).toHaveText("1–2 of 2");
    await expect(page.getByRole("button", { name: "Prev", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();

    // Past the last page: nothing listed, Prev leads back.
    await page.goto("/bills?page=2");
    await expect(page.getByTestId("page-range")).toHaveText("0 of 2");
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Prev", exact: true }).click();
    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByTestId("page-range")).toHaveText("1–2 of 2");

    await page.goto("/bills?page=abc&status=bogus&date=2026-02-30&method=x");
    await expect(rows(page)).toHaveCount(2);
  });
});
