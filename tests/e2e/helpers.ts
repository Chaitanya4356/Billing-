import { config } from "dotenv";
import type { Page } from "@playwright/test";
import { assertTestDatabaseUrl } from "../helpers/assert-test-db";
import type { TestShop } from "../helpers/db";

/**
 * Points this Node process at the TEST database. Must run before anything
 * imports src/db/client.ts, which reads DATABASE_URL once at import time;
 * that is why ../helpers/db is only ever imported dynamically below.
 */
function pointAtTestDatabase(): void {
  config({ path: ".env", quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set (see .env.example)");
  assertTestDatabaseUrl(url);
  process.env.DATABASE_URL = url;
}

/** Truncates the test database and seeds one shop with an owner and a cashier. */
export async function resetAndSeed(): Promise<TestShop> {
  pointAtTestDatabase();
  const { resetDb, makeShop } = await import("../helpers/db");
  await resetDb();
  return makeShop();
}

/** Signs in through the login form. Does not assert where it lands. */
export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
