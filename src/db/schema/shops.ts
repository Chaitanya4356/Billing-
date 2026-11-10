import { sql } from "drizzle-orm";
import { boolean, check, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const tokenResetModeEnum = pgEnum("token_reset_mode", ["DAILY", "NEVER"]);

export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  gstin: text("gstin"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shopSettings = pgTable(
  "shop_settings",
  {
    shopId: uuid("shop_id")
      .primaryKey()
      .references(() => shops.id),
    receiptHeader: text("receipt_header").notNull().default(""),
    receiptFooter: text("receipt_footer").notNull().default("Thank you! Visit again"),
    paperWidth: integer("paper_width").notNull().default(80),
    billPrefix: text("bill_prefix").notNull().default("B"),
    tokenResetMode: tokenResetModeEnum("token_reset_mode").notNull().default("DAILY"),
    dayStartHour: integer("day_start_hour").notNull().default(0),
    gstEnabled: boolean("gst_enabled").notNull().default(false),
    gstRateBp: integer("gst_rate_bp").notNull().default(500),
    gstInclusive: boolean("gst_inclusive").notNull().default(true),
    receiptTitle: text("receipt_title").notNull().default("Tax Invoice"),
    roundToRupee: boolean("round_to_rupee").notNull().default(false),
    cashierDiscountMaxPctBp: integer("cashier_discount_max_pct_bp").notNull().default(0),
    cashierDiscountMaxFlatPaise: integer("cashier_discount_max_flat_paise").notNull().default(0),
    cashierCanCancel: boolean("cashier_can_cancel").notNull().default(false),
  },
  (t) => [
    check("shop_settings_paper_width_check", sql`${t.paperWidth} IN (58, 80)`),
    check("shop_settings_day_start_hour_check", sql`${t.dayStartHour} BETWEEN 0 AND 23`),
  ],
);
