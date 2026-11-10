import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "../lib/env";
import * as schema from "./schema";

// Relative import: this module is also loaded by the Playwright Node runner, which does not resolve the "@/" alias.
// Throws one error naming every missing/invalid variable (copy .env.example to .env).
const env = getEnv();

// Reuse one pool across Next.js dev hot reloads.
const globalForPool = globalThis as unknown as { __billingPool?: Pool };
const pool = globalForPool.__billingPool ?? new Pool({ connectionString: env.DATABASE_URL });
if (env.NODE_ENV !== "production") globalForPool.__billingPool = pool;

export const db = drizzle(pool, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | Tx;
