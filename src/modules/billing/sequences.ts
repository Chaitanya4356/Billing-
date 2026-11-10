import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type TokenResetMode = "DAILY" | "NEVER";

export const billSequenceKey = (financialYear: string): string => `bill:${financialYear}`;

export const tokenSequenceKey = (mode: TokenResetMode, businessDate: string): string =>
  mode === "NEVER" ? "token:all" : `token:${businessDate}`;

/**
 * Atomically increments and returns the counter (first value is 1). One
 * statement: concurrent callers serialise on the row lock the upsert takes,
 * and the increment rolls back with the surrounding transaction (no gaps).
 */
export async function nextSequenceValue(tx: Tx, shopId: string, key: string): Promise<number> {
  const result = await tx.execute<{ last_value: number }>(sql`
    INSERT INTO number_sequences (shop_id, key, last_value)
    VALUES (${shopId}, ${key}, 1)
    ON CONFLICT (shop_id, key) DO UPDATE SET last_value = number_sequences.last_value + 1
    RETURNING last_value
  `);
  const value = result.rows[0]?.last_value;
  if (typeof value !== "number") throw new Error("number sequence upsert returned no value");
  return value;
}

/**
 * Raises the counter that `mode` uses to at least the highest token already
 * issued (all time for NEVER, that business date for DAILY), so switching the
 * reset mode can never re-issue a token. Never lowers a counter.
 */
export async function syncTokenSequence(
  tx: Tx,
  shopId: string,
  mode: TokenResetMode,
  businessDate: string,
): Promise<void> {
  const key = tokenSequenceKey(mode, businessDate);
  const dateFilter = mode === "DAILY" ? sql`AND business_date = ${businessDate}` : sql``;
  await tx.execute(sql`
    INSERT INTO number_sequences (shop_id, key, last_value)
    SELECT ${shopId}::uuid, ${key}::text, COALESCE(MAX(token_number), 0)
    FROM bills
    WHERE shop_id = ${shopId} ${dateFilter}
    ON CONFLICT (shop_id, key) DO UPDATE
      SET last_value = GREATEST(number_sequences.last_value, EXCLUDED.last_value)
  `);
}
