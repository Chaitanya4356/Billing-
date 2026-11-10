import path from "node:path";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { assertTestDatabaseUrl } from "./assert-test-db";

// Vitest globalSetup for the integration project: bring the test database up
// to date with the committed migrations before any test file runs.
export default async function setup(): Promise<void> {
  config({ path: ".env", quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set (see .env.example)");
  assertTestDatabaseUrl(url);
  if (url === process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL");
  }

  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(__dirname, "../../src/db/migrations"),
    });
  } finally {
    await pool.end();
  }
}
