import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  cancelBillViaUi,
  cart,
  chargeButton,
  chargeExact,
  countBills,
  installPrintHook,
  login,
  newBill,
  openBillingAs,
  payable,
  printed,
  resetAndSeed,
  successDialog,
  tile,
  type SeededShop,
} from "./helpers";

// One end-to-end story on a fresh database. The tests build on each other
// (tokens, bills, audit entries), so they run as one serial group. The owner
// and the cashier use separate browser contexts so their sessions never clash.
//
// Order of operations:
//   1. owner: creates product Vada (₹12) and lets cashiers give a ₹5 flat discount
//   2. cashier: bill 1 (cash, ₹42 - ₹2 = ₹40, token 1) and Print
//   3. cashier: bill 2 (UPI, ₹15, token 2) and Print
//   4. owner: cancels bill 2 with a reason
//   5. owner: Reports (Day) and the CSV show only bill 1
//   6. cashier: sees both bills in today's history, reprints bill 2 (CANCELLED + REPRINT) and bill 1 (REPRINT)
//   7. reprints and the cancel consumed no token: bill 3 gets token 3
//   8. owner: the audit log lists everything with readable labels
test.describe.configure({ mode: "serial" });

type Bill = { token: string; billNumber: string };

const billsTable = (page: Page) => page.getByRole("table", { name: "Bills" });
const billRows = (page: Page) => billsTable(page).locator("tbody tr");
const stat = (page: Page, id: string) => page.getByTestId(id);

test.describe("full flow: owner and cashier", () => {
  let shop: SeededShop;
  let ownerContext: BrowserContext;
  let cashierContext: BrowserContext;
  let owner: Page;
  let cashier: Page;
  let bill1: Bill;
  let bill2: Bill;

  async function newContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installPrintHook(page);
    return { context, page };
  }

  test.beforeAll(async ({ browser }) => {
    shop = await resetAndSeed();
    ({ context: ownerContext, page: owner } = await newContext(browser));
    ({ context: cashierContext, page: cashier } = await newContext(browser));
  });

  test.afterAll(async () => {
    await ownerContext?.close();
    await cashierContext?.close();
  });

  test("owner creates the product Vada and lets cashiers give a flat discount", async () => {
    await login(owner, shop.owner.username, shop.owner.password);
    await expect(owner).toHaveURL(/\/dashboard$/);

    await owner.goto("/products");
    await expect(owner.getByRole("heading", { name: "Products" })).toBeVisible();
    await owner.getByLabel("New category name").fill("Snacks");
    await owner.getByRole("button", { name: "Add category" }).click();
    await expect(owner.getByRole("link", { name: "Snacks", exact: true })).toBeVisible();
    await expect(owner).toHaveURL(/category=/);

    await owner.getByRole("button", { name: "Add product" }).click();
    const dialog = owner.getByRole("dialog", { name: "Add product" });
    await dialog.getByLabel("Product name").fill("Vada");
    await dialog.getByLabel("Price (₹)").fill("12");
    await dialog.getByRole("button", { name: "Save product" }).click();
    await expect(dialog).toBeHidden();
    await expect(owner.getByRole("row", { name: /Vada/ })).toContainText("₹12.00");

    await owner.goto("/settings?tab=discounts");
    await owner.getByLabel("Cashier flat discount limit (₹)").fill("5");
    await owner.getByRole("button", { name: "Save" }).click();
    await expect(owner.getByRole("status")).toHaveText("Saved");
    await owner.reload();
    await expect(owner.getByLabel("Cashier flat discount limit (₹)")).toHaveValue("5");
  });

  test("cashier charges bill 1 (cash, flat discount) and prints it from the success screen", async () => {
    await openBillingAs(cashier, shop.cashier, "CASHIER");

    await tile(cashier, "Masala Tea").click();
    await tile(cashier, "Masala Tea").click();
    await tile(cashier, "Vada").click();
    await expect(cart(cashier).getByRole("listitem")).toHaveCount(2);
    await expect(payable(cashier)).toHaveText("₹42.00");

    await cashier.getByLabel("Discount amount").fill("2");
    await expect(payable(cashier)).toHaveText("₹40.00");
    await chargeExact(cashier);

    const success = successDialog(cashier);
    await expect(success.getByTestId("success-token")).toHaveText("1");
    await expect(success.getByTestId("success-total")).toHaveText("₹40.00");
    bill1 = {
      token: (await success.getByTestId("success-token").innerText()).trim(),
      billNumber: (await success.getByTestId("success-bill-number").innerText()).trim(),
    };

    // No auto-print: nothing reaches the printer until Print is clicked.
    await expect(success.getByRole("button", { name: "Print" })).toBeFocused();
    expect(await printed(cashier)).toEqual([]);

    await success.getByRole("button", { name: "Print" }).click();
    await expect.poll(async () => (await printed(cashier)).length).toBe(1);
    const [html] = await printed(cashier);
    expect(html).toContain(`<div class="token">${bill1.token}</div>`);
    expect(html).toContain("Masala Tea");
    expect(html).toContain("Vada");
    expect(html).not.toContain("REPRINT");
    expect(html).not.toContain("CANCELLED");

    await newBill(cashier);
    expect(await countBills(shop.shopId)).toBe(1);
  });

  test("cashier charges bill 2 (UPI, payment received) and prints it", async () => {
    await tile(cashier, "Samosa").click();
    await expect(payable(cashier)).toHaveText("₹15.00");
    await cashier.getByRole("button", { name: "UPI", exact: true }).click();
    await cashier.getByLabel(/Payment received/).check();
    await expect(chargeButton(cashier)).toBeEnabled();
    await chargeButton(cashier).click();

    const success = successDialog(cashier);
    await expect(success).toBeVisible();
    await expect(success.getByTestId("success-token")).toHaveText("2");
    await expect(success.getByTestId("success-total")).toHaveText("₹15.00");
    bill2 = {
      token: (await success.getByTestId("success-token").innerText()).trim(),
      billNumber: (await success.getByTestId("success-bill-number").innerText()).trim(),
    };
    expect(bill2.billNumber).not.toBe(bill1.billNumber);

    // Bill 1's print is still the only one: this bill has not been printed yet.
    expect(await printed(cashier)).toHaveLength(1);
    await success.getByRole("button", { name: "Print" }).click();
    await expect.poll(async () => (await printed(cashier)).length).toBe(2);
    const html = (await printed(cashier))[1];
    expect(html).toContain(`<div class="token">${bill2.token}</div>`);
    expect(html).toContain("Samosa");
    expect(html).not.toContain("REPRINT");

    await newBill(cashier);
    expect(await countBills(shop.shopId)).toBe(2);
  });

  test("owner cancels bill 2 with a reason", async () => {
    await cancelBillViaUi(owner, bill2.billNumber, "Customer changed their mind");
    await expect(billRows(owner).filter({ hasText: bill2.billNumber })).toContainText("CANCELLED");
    await expect(billRows(owner).filter({ hasText: bill1.billNumber })).toContainText("COMPLETED");
  });

  test("owner's Day report and CSV count only the bill that was not cancelled", async () => {
    await owner.goto("/reports");
    await expect(owner.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    await expect(owner.getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(stat(owner, "stat-gross")).toHaveText("₹42.00");
    await expect(stat(owner, "stat-discounts")).toHaveText("₹2.00");
    await expect(stat(owner, "stat-net-total")).toHaveText("₹40.00");
    await expect(stat(owner, "stat-bills")).toHaveText("1");
    await expect(stat(owner, "stat-cash")).toHaveText("₹40.00");
    await expect(stat(owner, "stat-upi")).toHaveText("₹0.00");
    await expect(stat(owner, "stat-cancelled")).toHaveText("1");
    await expect(stat(owner, "stat-cancelled-amount")).toHaveText("₹15.00");

    const res = await owner.request.get("/reports/export?period=day");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("Date,Bill No,Token,Status,Subtotal,Discount,GST,Total,Payment Method");
    const lines = body.split("\r\n");
    const row1 = lines.find((l) => l.includes(bill1.billNumber));
    const row2 = lines.find((l) => l.includes(bill2.billNumber));
    expect(row1, "CSV row for bill 1").toBeDefined();
    expect(row1).toContain("COMPLETED");
    expect(row1).toContain("40.00");
    expect(row2, "CSV row for bill 2").toBeDefined();
    expect(row2).toContain("CANCELLED");
    expect(body).toContain("Net total,40.00");
  });

  test("cashier sees both bills today and reprints them; the cancelled one is marked CANCELLED", async () => {
    await cashier.goto("/bills");
    await expect(billsTable(cashier)).toBeVisible();
    await expect(billRows(cashier)).toHaveCount(2);
    await expect(billRows(cashier).filter({ hasText: bill1.billNumber })).toContainText("COMPLETED");
    await expect(billRows(cashier).filter({ hasText: bill2.billNumber })).toContainText("CANCELLED");
    // Opening a page or a bill never prints (the page load reset the hook list).
    expect(await printed(cashier)).toEqual([]);

    // Bill 2: printed once before it was cancelled, so this is a REPRINT of a CANCELLED bill.
    await billRows(cashier).filter({ hasText: bill2.billNumber }).click();
    const drawer2 = cashier.getByRole("dialog", { name: `Bill ${bill2.billNumber}` });
    await expect(drawer2.getByTestId("bill-status")).toHaveText("CANCELLED");
    await expect(drawer2.getByTestId("bill-print-count")).toHaveText("1");
    await drawer2.getByRole("button", { name: "Reprint" }).click();
    await expect.poll(async () => (await printed(cashier)).length).toBe(1);
    const html2 = (await printed(cashier))[0];
    expect(html2).toContain("CANCELLED");
    expect(html2).toContain("REPRINT");
    expect(html2).toContain(`<div class="token">${bill2.token}</div>`);
    await expect(drawer2.getByTestId("bill-print-count")).toHaveText("2");
    await drawer2.getByRole("button", { name: "Close" }).click();
    await expect(drawer2).toBeHidden();

    // Bill 1: a plain REPRINT.
    await billRows(cashier).filter({ hasText: bill1.billNumber }).click();
    const drawer1 = cashier.getByRole("dialog", { name: `Bill ${bill1.billNumber}` });
    await expect(drawer1.getByTestId("bill-status")).toHaveText("COMPLETED");
    await drawer1.getByRole("button", { name: "Reprint" }).click();
    await expect.poll(async () => (await printed(cashier)).length).toBe(2);
    const html1 = (await printed(cashier))[1];
    expect(html1).toContain("REPRINT");
    expect(html1).not.toContain("CANCELLED");
    expect(html1).toContain(`<div class="token">${bill1.token}</div>`);
    await expect(drawer1.getByTestId("bill-print-count")).toHaveText("2");
    await drawer1.getByRole("button", { name: "Close" }).click();
    await expect(drawer1).toBeHidden();
  });

  test("reprints and the cancel consumed no token: the next bill is token 3", async () => {
    expect(await countBills(shop.shopId)).toBe(2);

    await openBillingAs(cashier, shop.cashier, "CASHIER");
    await tile(cashier, "Vada").click();
    await chargeExact(cashier);
    await expect(successDialog(cashier).getByTestId("success-token")).toHaveText("3");
    await expect(successDialog(cashier).getByTestId("success-bill-number")).toHaveText(/-000003$/);
    await newBill(cashier);
    expect(await countBills(shop.shopId)).toBe(3);
  });

  test("the audit log lists the whole flow with readable labels", async () => {
    await owner.goto("/settings?tab=audit");
    const table = owner.getByRole("table", { name: "Audit log, newest first" });
    await expect(table).toBeVisible();
    const labels = await table
      .locator("tbody tr")
      .evaluateAll((rows) => rows.map((r) => r.querySelectorAll("td")[2]?.textContent?.trim() ?? ""));

    const count = (label: string) => labels.filter((l) => l === label).length;
    expect(count("Bill created")).toBe(3);
    expect(count("Bill cancelled")).toBe(1);
    expect(count("Bill printed")).toBe(2);
    expect(count("Bill reprinted")).toBe(2);
    expect(count("Product created")).toBe(1);
    expect(count("Settings changed")).toBeGreaterThanOrEqual(1);

    await expect(table.locator("tbody tr").filter({ hasText: "Product created" })).toContainText("Test Owner");
    await expect(table.locator("tbody tr").filter({ hasText: "Bill cancelled" })).toContainText("Test Owner");
  });
});
