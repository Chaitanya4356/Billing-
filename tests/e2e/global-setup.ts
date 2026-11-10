import migrateTestDatabase from "../helpers/global-setup";
import { resetAndSeed } from "./helpers";

// Playwright globalSetup: migrate the test database, then reset and seed it
// once so the schema and a shop exist before the first spec runs.
export default async function globalSetup(): Promise<void> {
  await migrateTestDatabase();
  await resetAndSeed();
  // Close the pool opened by src/db/client.ts so this runner process can exit.
  const { db } = await import("../../src/db/client");
  await db.$client.end();
  delete (globalThis as { __billingPool?: unknown }).__billingPool;
}
