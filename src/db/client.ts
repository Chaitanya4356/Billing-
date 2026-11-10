import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
}

// Reuse one pool across Next.js dev hot reloads.
const globalForPool = globalThis as unknown as { __billingPool?: Pool };
const pool = globalForPool.__billingPool ?? new Pool({ connectionString });
if (process.env.NODE_ENV !== "production") globalForPool.__billingPool = pool;

export const db = drizzle(pool, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | Tx;
