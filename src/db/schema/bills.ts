import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./catalog";
import { shops } from "./shops";
import { users } from "./users";

export const billStatusEnum = pgEnum("bill_status", ["COMPLETED", "CANCELLED"]);
export const discountTypeEnum = pgEnum("discount_type", ["FLAT", "PERCENT"]);
export const paymentMethodEnum = pgEnum("payment_method", ["CASH", "UPI"]);
export const paymentStatusEnum = pgEnum("payment_status", ["RECORDED", "VOIDED"]);

export const bills = pgTable(
  "bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** Indian financial year of business_date, e.g. '2026-27'. Bill numbers restart each FY. */
    financialYear: text("financial_year").notNull(),
    billNumber: integer("bill_number").notNull(),
    billNumberDisplay: text("bill_number_display").notNull(),
    tokenNumber: integer("token_number").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    status: billStatusEnum("status").notNull().default("COMPLETED"),
    subtotalPaise: integer("subtotal_paise").notNull(),
    discountType: discountTypeEnum("discount_type"),
    discountValue: integer("discount_value").notNull().default(0),
    discountPaise: integer("discount_paise").notNull().default(0),
    taxablePaise: integer("taxable_paise").notNull().default(0),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    taxPaise: integer("tax_paise").notNull().default(0),
    taxIncluded: boolean("tax_included").notNull(),
    roundOffPaise: integer("round_off_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    printCount: integer("print_count").notNull().default(0),
    lastPrintedAt: timestamp("last_printed_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    shopSnapshot: jsonb("shop_snapshot").notNull(),
    gstSnapshot: jsonb("gst_snapshot").notNull(),
  },
  (t) => [
    unique("bills_shop_id_financial_year_bill_number_unique").on(t.shopId, t.financialYear, t.billNumber),
    unique("bills_shop_id_business_date_token_number_unique").on(t.shopId, t.businessDate, t.tokenNumber),
    unique("bills_shop_id_idempotency_key_unique").on(t.shopId, t.idempotencyKey),
    // Target for the composite (bill_id, shop_id) FKs on child tables.
    unique("bills_id_shop_id_unique").on(t.id, t.shopId),
    index("bills_shop_id_business_date_idx").on(t.shopId, t.businessDate),
    index("bills_shop_id_created_at_idx").on(t.shopId, t.createdAt.desc()),
    check("bills_total_paise_check", sql`${t.totalPaise} >= 0`),
    check(
      "bills_total_formula_check",
      sql`${t.totalPaise} = ${t.subtotalPaise} - ${t.discountPaise} + CASE WHEN ${t.taxIncluded} THEN 0 ELSE ${t.taxPaise} END + ${t.roundOffPaise}`,
    ),
  ],
);

export const billItems = pgTable(
  "bill_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    billId: uuid("bill_id").notNull(),
    // Nullable and never cascading: bill history must survive product removal.
    productId: uuid("product_id").references(() => products.id),
    productName: text("product_name").notNull(),
    categoryName: text("category_name").notNull(),
    unitPricePaise: integer("unit_price_paise").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalPaise: integer("line_total_paise").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "bill_items_bill_id_shop_id_bills_fk",
      columns: [t.billId, t.shopId],
      foreignColumns: [bills.id, bills.shopId],
    }),
    index("bill_items_bill_id_idx").on(t.billId),
    check("bill_items_quantity_check", sql`${t.quantity} > 0`),
    check("bill_items_unit_price_paise_check", sql`${t.unitPricePaise} >= 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    billId: uuid("bill_id").notNull(),
    method: paymentMethodEnum("method").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    cashTenderedPaise: integer("cash_tendered_paise"),
    changePaise: integer("change_paise"),
    upiReference: text("upi_reference"),
    status: paymentStatusEnum("status").notNull().default("RECORDED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "payments_bill_id_shop_id_bills_fk",
      columns: [t.billId, t.shopId],
      foreignColumns: [bills.id, bills.shopId],
    }),
    index("payments_bill_id_idx").on(t.billId),
  ],
);
