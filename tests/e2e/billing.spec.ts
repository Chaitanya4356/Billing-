import { expect, test, type Page } from "@playwright/test";
import { countBills, login, resetAndSeed, setProductPrice, setShopGst, type SeededShop } from "./helpers";

// Every group starts from a fresh database (tokens and bill numbers restart at
// 1), and the tests inside a group build on each other.
test.describe.configure({ mode: "serial" });

const PRICE_CHANGED_MESSAGE = "Prices or tax settings changed. Please review the new total and charge again.";

/** Installs the print test seam: every receipt HTML is collected in window.__printed. */
async function installPrintHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: string[]; __PRINT_HOOK__: (html: string) => void };
    w.__printed = [];
    w.__PRINT_HOOK__ = (html: string) => {
      w.__printed.push(html);
    };
  });
}

function printed(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __printed: string[] }).__printed);
}

async function openBillingAs(page: Page, user: { username: string; password: string }, role: "OWNER" | "CASHIER") {
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

const tile = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^Add ${name}`) });
const cart = (page: Page) => page.getByRole("region", { name: "Cart" });
const payable = (page: Page) => page.getByTestId("payable-amount");
const chargeButton = (page: Page) => page.getByRole("button", { name: /^Charge/ });
const cashInput = (page: Page) => page.getByLabel("Cash received (₹)");
const successDialog = (page: Page) => page.getByRole("dialog", { name: "Bill saved" });

async function chargeExact(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Exact", exact: true }).click();
  await expect(chargeButton(page)).toBeEnabled();
  await chargeButton(page).click();
  await expect(successDialog(page)).toBeVisible();
}

async function newBill(page: Page): Promise<void> {
  await successDialog(page).getByRole("button", { name: "New Bill" }).click();
  await expect(successDialog(page)).toBeHidden();
}

test.describe("cash charge, success screen and print", () => {
  let shop: SeededShop;
  test.beforeAll(async () => {
    shop = await resetAndSeed();
  });

  test("cashier bills 2 x Masala Tea + 1 x Samosa by cash; success shows token 1, bill number and total", async ({
    page,
  }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");

    await tile(page, "Masala Tea").click();
    await tile(page, "Masala Tea").click();
    await tile(page, "Samosa").click();
    await expect(cart(page).getByRole("listitem")).toHaveCount(2);
    await expect(cart(page).getByLabel("Quantity of Masala Tea")).toHaveValue("2");
    await expect(payable(page)).toHaveText("₹45.00");

    await page.getByRole("button", { name: "Cash", exact: true }).click();
    await page.getByRole("button", { name: "Exact", exact: true }).click();
    await expect(cashInput(page)).toHaveValue("45");
    await chargeButton(page).click();

    const success = successDialog(page);
    await expect(success).toBeVisible();
    await expect(success.getByTestId("success-token")).toHaveText("1");
    await expect(success.getByTestId("success-bill-number")).toHaveText(/^B-\d{4}-000001$/);
    await expect(success.getByTestId("success-total")).toHaveText("₹45.00");
    await expect(success.getByRole("button", { name: "Print" })).toBeFocused();

    // Nothing printed on its own.
    await page.waitForTimeout(1000);
    expect(await printed(page)).toEqual([]);

    await newBill(page);
    await expect(cart(page).getByRole("listitem")).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "Search products" })).toBeFocused();
    await expect(cashInput(page)).toHaveValue("");
    expect(await countBills(shop.shopId)).toBe(1);
  });

  test("Print sends the receipt to the printer once per click; the second is marked REPRINT", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    await tile(page, "Samosa").click();
    await chargeExact(page);
    await expect(successDialog(page).getByTestId("success-token")).toHaveText("2");

    // No auto-print.
    await page.waitForTimeout(1000);
    expect(await printed(page)).toEqual([]);

    const print = successDialog(page).getByRole("button", { name: "Print" });
    await print.click();
    await expect.poll(async () => (await printed(page)).length).toBe(1);
    const [first] = await printed(page);
    expect(first).toContain("Samosa");
    expect(first).toMatch(/000002/);
    expect(first).not.toContain("REPRINT");

    await expect(print).toBeEnabled();
    await print.click();
    await expect.poll(async () => (await printed(page)).length).toBe(2);
    const second = (await printed(page))[1];
    expect(second).toContain("REPRINT");
  });
});

test.describe("double submit", () => {
  let shop: SeededShop;
  test.beforeAll(async () => {
    shop = await resetAndSeed();
  });

  test("double-clicking Charge (or two synchronous clicks) creates exactly one bill", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    await tile(page, "Masala Tea").click();
    await page.getByRole("button", { name: "Exact", exact: true }).click();
    await chargeButton(page).dblclick();
    await expect(successDialog(page)).toBeVisible();
    await expect(successDialog(page).getByTestId("success-token")).toHaveText("1");
    await page.waitForTimeout(500);
    expect(await countBills(shop.shopId)).toBe(1);

    await newBill(page);
    await tile(page, "Samosa").click();
    await page.getByRole("button", { name: "Exact", exact: true }).click();
    // Server action calls (POSTs with a Next-Action header) from here on.
    let actionPosts = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actionPosts++;
    });
    // Two clicks in the same task, before React can re-render the disabled state.
    await chargeButton(page).evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
    await expect(successDialog(page)).toBeVisible();
    await expect(successDialog(page).getByTestId("success-token")).toHaveText("2");
    await page.waitForTimeout(500);
    expect(await countBills(shop.shopId)).toBe(2);
    // The in-flight guard sent one request, not two (idempotency is the second line of defence).
    expect(actionPosts).toBe(1);
  });
});

test.describe("payment validation", () => {
  let shop: SeededShop;
  test.beforeAll(async () => {
    shop = await resetAndSeed();
  });

  test("UPI cannot be charged until Payment received is ticked", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    await tile(page, "Samosa").click();
    await page.getByRole("button", { name: "UPI", exact: true }).click();
    await expect(chargeButton(page)).toBeDisabled();
    await page.getByLabel("UPI reference (optional)").fill("UTR12345");
    await expect(chargeButton(page)).toBeDisabled();
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(500);
    expect(await countBills(shop.shopId)).toBe(0);

    await page.getByLabel("Payment received").check();
    await expect(chargeButton(page)).toBeEnabled();
    await chargeButton(page).click();
    await expect(successDialog(page).getByTestId("success-token")).toHaveText("1");
    await expect(successDialog(page).getByTestId("success-total")).toHaveText("₹15.00");
  });

  test("an invalid cash amount like 12.5.5 shows an inline error and blocks Charge", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    await tile(page, "Samosa").click();
    await cashInput(page).fill("12.5.5");
    await expect(page.getByRole("alert").filter({ hasText: "valid amount" })).toBeVisible();
    await expect(chargeButton(page)).toBeDisabled();

    await cashInput(page).fill("10");
    await expect(page.getByText("less than the payable amount")).toBeVisible();
    await expect(chargeButton(page)).toBeDisabled();

    await page.getByRole("button", { name: "₹50", exact: true }).click();
    await expect(cashInput(page)).toHaveValue("50");
    await expect(page.getByTestId("change-due")).toHaveText("₹35.00");
    await expect(chargeButton(page)).toBeEnabled();
    expect(await countBills(shop.shopId)).toBe(1);
  });

  test("an invalid customer phone is shown under the field and nothing is charged", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    await tile(page, "Samosa").click();
    await page.getByRole("button", { name: "Add customer details" }).click();
    await page.getByLabel("Customer name").fill("Ravi");
    await page.getByLabel("Customer phone").fill("12345");
    await page.getByRole("button", { name: "Exact", exact: true }).click();
    await chargeButton(page).click();
    await expect(page.locator("#customer-phone-error")).toHaveText("Enter a valid phone number");
    await expect(successDialog(page)).toBeHidden();
    expect(await countBills(shop.shopId)).toBe(1);

    await page.getByLabel("Customer phone").fill("");
    await expect(page.locator("#customer-phone-error")).toHaveCount(0);
    await chargeButton(page).click();
    await expect(successDialog(page).getByTestId("success-token")).toHaveText("2");
  });
});

test.describe("prices and settings changed behind the cashier", () => {
  let shop: SeededShop;
  test.beforeAll(async () => {
    shop = await resetAndSeed();
  });

  test("a changed product price refreshes the cart and charges nothing", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    await tile(page, "Masala Tea").click();
    await expect(payable(page)).toHaveText("₹15.00");
    await page.getByRole("button", { name: "Exact", exact: true }).click();

    await setProductPrice(shop.products.masalaTea, 2000);
    await chargeButton(page).click();

    await expect(page.getByRole("status").filter({ hasText: PRICE_CHANGED_MESSAGE })).toBeVisible();
    await expect(successDialog(page)).toBeHidden();
    await expect(payable(page)).toHaveText("₹20.00");
    await expect(cart(page).getByRole("listitem").filter({ hasText: "Masala Tea" })).toContainText("₹20.00");
    expect(await countBills(shop.shopId)).toBe(0);
    // The ₹15 tendered no longer covers the bill.
    await expect(chargeButton(page)).toBeDisabled();

    await chargeExact(page);
    await expect(successDialog(page).getByTestId("success-token")).toHaveText("1");
    await expect(successDialog(page).getByTestId("success-total")).toHaveText("₹20.00");
  });

  test("a GST change recalculates the payable from fresh settings; charging again succeeds", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    await tile(page, "Samosa").click();
    await tile(page, "Samosa").click();
    await tile(page, "Samosa").click();
    await expect(payable(page)).toHaveText("₹45.00");
    await page.getByRole("button", { name: "Exact", exact: true }).click();

    await setShopGst(shop.shopId, { enabled: true, rateBp: 500, inclusive: false });
    await chargeButton(page).click();

    await expect(page.getByRole("status").filter({ hasText: PRICE_CHANGED_MESSAGE })).toBeVisible();
    await expect(successDialog(page)).toBeHidden();
    // 45.00 + 5% exclusive GST (2.25).
    await expect(payable(page)).toHaveText("₹47.25");
    expect(await countBills(shop.shopId)).toBe(1);

    await chargeExact(page);
    await expect(successDialog(page).getByTestId("success-token")).toHaveText("2");
    await expect(successDialog(page).getByTestId("success-total")).toHaveText("₹47.25");
    expect(await countBills(shop.shopId)).toBe(2);
  });
});

test.describe("keyboard shortcuts", () => {
  let shop: SeededShop;
  test.beforeAll(async () => {
    shop = await resetAndSeed();
  });

  test("/ focuses search, Enter adds the top result, Ctrl+Enter charges", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    const search = page.getByRole("searchbox", { name: "Search products" });
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");

    await page.keyboard.type("samo");
    await expect(tile(page, "Masala Tea")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(search).toHaveValue("");
    await expect(cart(page).getByRole("listitem").filter({ hasText: "Samosa" })).toBeVisible();

    // Ctrl+Enter is ignored while Charge is not allowed (no cash entered yet).
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(500);
    await expect(successDialog(page)).toBeHidden();

    await page.getByRole("button", { name: "Exact", exact: true }).click();
    await page.keyboard.press("Control+Enter");
    await expect(successDialog(page).getByTestId("success-token")).toHaveText("1");
    expect(await countBills(shop.shopId)).toBe(1);
    await newBill(page);
  });

  test("Esc asks for confirmation before clearing a non-empty cart", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    await tile(page, "Masala Tea").click();
    await tile(page, "Samosa").click();
    await expect(cart(page).getByRole("listitem")).toHaveCount(2);

    await page.keyboard.press("Escape");
    const confirm = page.getByRole("alertdialog", { name: "Clear the cart?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Keep items" }).click();
    await expect(confirm).toBeHidden();
    await expect(cart(page).getByRole("listitem")).toHaveCount(2);

    await page.keyboard.press("Escape");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Clear cart" }).click();
    await expect(cart(page).getByRole("listitem")).toHaveCount(0);
    await expect(payable(page)).toHaveText("₹0.00");
  });
});

test.describe("discounts", () => {
  let shop: SeededShop;
  test.beforeAll(async () => {
    shop = await resetAndSeed();
  });

  test("a cashier with the default limits (0) cannot discount", async ({ page }) => {
    await openBillingAs(page, shop.cashier, "CASHIER");
    await tile(page, "Masala Tea").click();
    await expect(page.getByText("Discounts are not allowed for cashiers")).toBeVisible();
    await expect(page.getByLabel("Discount amount")).toHaveCount(0);
  });

  test("an owner applies a flat and a percent discount", async ({ page }) => {
    await openBillingAs(page, shop.owner, "OWNER");
    await tile(page, "Masala Tea").click();
    await tile(page, "Masala Tea").click();
    await expect(payable(page)).toHaveText("₹30.00");

    await page.getByLabel("Discount amount").fill("5");
    await expect(payable(page)).toHaveText("₹25.00");

    await page.getByRole("button", { name: "Percent discount" }).click();
    await page.getByLabel("Discount amount").fill("10");
    await expect(payable(page)).toHaveText("₹27.00");

    await page.getByLabel("Discount amount").fill("");
    await expect(payable(page)).toHaveText("₹30.00");

    await page.getByLabel("Discount amount").fill("10");
    await chargeExact(page);
    await expect(successDialog(page).getByTestId("success-total")).toHaveText("₹27.00");
    expect(await countBills(shop.shopId)).toBe(1);
  });
});
