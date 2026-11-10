import { expect, test } from "@playwright/test";
import { resetAndSeed } from "./helpers";

test.beforeAll(async () => {
  await resetAndSeed();
});

test("home page shows the Billing heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Billing/ })).toBeVisible();
});
