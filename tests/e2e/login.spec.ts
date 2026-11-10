import { expect, test } from "@playwright/test";
import type { TestShop } from "../helpers/db";
import { login, resetAndSeed } from "./helpers";

let shop: TestShop;

test.beforeAll(async () => {
  shop = await resetAndSeed();
});

test("wrong password shows a generic error and sets no session cookie", async ({ page, context }) => {
  await login(page, shop.owner.username, "definitely-wrong");
  await expect(page.getByText("Invalid username or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "session")).toBeUndefined();
});

test("owner login sets the session cookie and lands on /dashboard", async ({ page, context }) => {
  await login(page, shop.owner.username, shop.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  const session = (await context.cookies()).find((c) => c.name === "session");
  expect(session).toBeDefined();
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe("Strict");
  expect(session!.path).toBe("/");
  expect(session!.expires).toBeGreaterThan(Date.now() / 1000);
});

test("cashier login lands on /billing", async ({ page, context }) => {
  await login(page, shop.cashier.username, shop.cashier.password);
  await expect(page).toHaveURL(/\/billing$/);
  expect((await context.cookies()).some((c) => c.name === "session")).toBe(true);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the form still signs in and shows errors", async ({ page }) => {
    await login(page, shop.cashier.username, "definitely-wrong");
    await expect(page.getByText("Invalid username or password")).toBeVisible();
    await login(page, shop.cashier.username, shop.cashier.password);
    await expect(page).toHaveURL(/\/billing$/);
  });
});
