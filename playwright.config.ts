import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env", quiet: true });

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
if (!testDatabaseUrl) {
  throw new Error("DATABASE_URL_TEST is not set (see .env.example)");
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Never reuse: an already-running dev server may be bound to the dev DB.
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: testDatabaseUrl },
  },
});
