CREATE TYPE "public"."token_reset_mode" AS ENUM('DAILY', 'NEVER');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('OWNER', 'CASHIER');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('FLAT', 'PERCENT');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'UPI');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('RECORDED', 'VOIDED');--> statement-breakpoint
CREATE TABLE "shop_settings" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"receipt_header" text DEFAULT '' NOT NULL,
	"receipt_footer" text DEFAULT 'Thank you! Visit again' NOT NULL,
	"paper_width" integer DEFAULT 80 NOT NULL,
	"bill_prefix" text DEFAULT 'B' NOT NULL,
	"token_reset_mode" "token_reset_mode" DEFAULT 'DAILY' NOT NULL,
	"day_start_hour" integer DEFAULT 0 NOT NULL,
	"gst_enabled" boolean DEFAULT false NOT NULL,
	"gst_rate_bp" integer DEFAULT 500 NOT NULL,
	"gst_inclusive" boolean DEFAULT true NOT NULL,
	"receipt_title" text DEFAULT 'Tax Invoice' NOT NULL,
	"round_to_rupee" boolean DEFAULT false NOT NULL,
	"cashier_discount_max_pct_bp" integer DEFAULT 0 NOT NULL,
	"cashier_discount_max_flat_paise" integer DEFAULT 0 NOT NULL,
	"cashier_can_cancel" boolean DEFAULT false NOT NULL,
	CONSTRAINT "shop_settings_paper_width_check" CHECK ("shop_settings"."paper_width" IN (58, 80)),
	CONSTRAINT "shop_settings_day_start_hour_check" CHECK ("shop_settings"."day_start_hour" BETWEEN 0 AND 23)
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"gstin" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_shop_id_username_unique" UNIQUE("shop_id","username")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_paise" integer NOT NULL,
	"short_code" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"category_name" text NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_paise" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bill_items_quantity_check" CHECK ("bill_items"."quantity" > 0),
	CONSTRAINT "bill_items_unit_price_paise_check" CHECK ("bill_items"."unit_price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"bill_number" integer NOT NULL,
	"bill_number_display" text NOT NULL,
	"token_number" integer NOT NULL,
	"business_date" date NOT NULL,
	"status" "bill_status" DEFAULT 'COMPLETED' NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"discount_type" "discount_type",
	"discount_value" integer DEFAULT 0 NOT NULL,
	"discount_paise" integer DEFAULT 0 NOT NULL,
	"taxable_paise" integer DEFAULT 0 NOT NULL,
	"cgst_paise" integer DEFAULT 0 NOT NULL,
	"sgst_paise" integer DEFAULT 0 NOT NULL,
	"tax_paise" integer DEFAULT 0 NOT NULL,
	"tax_included" boolean NOT NULL,
	"round_off_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"print_count" integer DEFAULT 0 NOT NULL,
	"last_printed_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"shop_snapshot" jsonb NOT NULL,
	"gst_snapshot" jsonb NOT NULL,
	CONSTRAINT "bills_shop_id_bill_number_unique" UNIQUE("shop_id","bill_number"),
	CONSTRAINT "bills_shop_id_business_date_token_number_unique" UNIQUE("shop_id","business_date","token_number"),
	CONSTRAINT "bills_shop_id_idempotency_key_unique" UNIQUE("shop_id","idempotency_key"),
	CONSTRAINT "bills_total_paise_check" CHECK ("bills"."total_paise" >= 0),
	CONSTRAINT "bills_total_formula_check" CHECK ("bills"."total_paise" = "bills"."subtotal_paise" - "bills"."discount_paise" + CASE WHEN "bills"."tax_included" THEN 0 ELSE "bills"."tax_paise" END + "bills"."round_off_paise")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_paise" integer NOT NULL,
	"cash_tendered_paise" integer,
	"change_paise" integer,
	"upi_reference" text,
	"status" "payment_status" DEFAULT 'RECORDED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"shop_id" uuid NOT NULL,
	"key" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_sequences_shop_id_key_pk" PRIMARY KEY("shop_id","key")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_shop_id_lower_name_unique" ON "categories" USING btree ("shop_id",lower("name"));--> statement-breakpoint
CREATE INDEX "products_shop_id_category_id_is_active_idx" ON "products" USING btree ("shop_id","category_id","is_active");--> statement-breakpoint
CREATE INDEX "bill_items_bill_id_idx" ON "bill_items" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bills_shop_id_business_date_idx" ON "bills" USING btree ("shop_id","business_date");--> statement-breakpoint
CREATE INDEX "bills_shop_id_created_at_idx" ON "bills" USING btree ("shop_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_bill_id_idx" ON "payments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "audit_logs_shop_id_created_at_idx" ON "audit_logs" USING btree ("shop_id","created_at" DESC NULLS LAST);