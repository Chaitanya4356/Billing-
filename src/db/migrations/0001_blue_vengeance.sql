ALTER TABLE "bills" DROP CONSTRAINT "bills_shop_id_bill_number_unique";--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "financial_year" text;--> statement-breakpoint
-- Backfill any existing rows from business_date (Indian FY, April to March, e.g. '2026-27').
UPDATE "bills" SET "financial_year" =
  (CASE WHEN EXTRACT(MONTH FROM "business_date") >= 4 THEN EXTRACT(YEAR FROM "business_date") ELSE EXTRACT(YEAR FROM "business_date") - 1 END)::int::text
  || '-' ||
  lpad((((CASE WHEN EXTRACT(MONTH FROM "business_date") >= 4 THEN EXTRACT(YEAR FROM "business_date") ELSE EXTRACT(YEAR FROM "business_date") - 1 END)::int + 1) % 100)::text, 2, '0');--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "financial_year" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_shop_id_financial_year_bill_number_unique" UNIQUE("shop_id","financial_year","bill_number");
