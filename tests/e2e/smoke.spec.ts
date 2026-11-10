import { expect, test } from "@playwright/test";
import { resetAndSeed } from "./helpers";

test.beforeAll(async () => {
  await resetAndSeed();
});

test("signed-out home lands on the login page with the Billing heading", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
});
