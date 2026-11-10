import { integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shops";

// Keys look like `bill:2026-27` and `token:2026-11-10`. Incremented with an
// atomic upsert inside the bill transaction.
export const numberSequences = pgTable(
  "number_sequences",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    key: text("key").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.key] })],
);
