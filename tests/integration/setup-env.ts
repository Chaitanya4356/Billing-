// Runs before any integration test file imports application code, so that
// src/db/client.ts connects to the test database.
import { config } from "dotenv";
import { assertTestDatabaseUrl } from "../helpers/assert-test-db";

config({ path: ".env", quiet: true });

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error("DATABASE_URL_TEST is not set (see .env.example)");
}
assertTestDatabaseUrl(testUrl);
if (testUrl === process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL");
}
process.env.DATABASE_URL = testUrl;
