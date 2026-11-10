// Runs before any integration test file imports application code, so that
// src/db/client.ts connects to the test database.
import { config } from "dotenv";

config({ path: ".env", quiet: true });

if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST is not set (see .env.example)");
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
