import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

const INT32_MAX = 2_147_483_647;
export const MAX_ITEMS = 100;
export const MAX_QUANTITY = 999;
/** Upper bound for cash tendered: keeps tendered and change inside Postgres int4. */
export const MAX_CASH_TENDERED_PAISE = 2_000_000_000;
/** Upper bound for the displayed total (the largest possible total is 2_000_000_050 only with rounding at the cap). */
export const MAX_EXPECTED_TOTAL_PAISE = 2_000_000_000;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id");

/** Trims; blank (or null/absent) becomes null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is at most ${max} characters`)
    .nullish()
    .transform((s) => (s ? s : null));

const item = z
  .object({
    productId: uuid.transform((s) => s.toLowerCase()),
    quantity: z
      .number()
      .int("Quantity must be a whole number")
      .min(1, "Quantity must be at least 1")
      .max(MAX_QUANTITY, `Quantity is at most ${MAX_QUANTITY}`),
    /** Only compared with the current catalog price; never used for calculation. */
    expectedUnitPricePaise: z.number().int().min(0).max(INT32_MAX),
  })
  .strict();

const discount = z
  .object({
    type: z.enum(["FLAT", "PERCENT"]),
    value: z.number().int("Discount must be a whole number").min(1, "Discount must be positive").max(INT32_MAX),
  })
  .strict()
  .nullable();

const cashPayment = z
  .object({
    method: z.literal("CASH"),
    cashTenderedPaise: z
      .number()
      .int("Cash tendered must be a whole number of paise")
      .min(0, "Cash tendered cannot be negative")
      .max(MAX_CASH_TENDERED_PAISE, "Cash tendered is too large"),
  })
  .strict();

const upiPayment = z
  .object({
    method: z.literal("UPI"),
    confirmed: z.literal(true, { error: "Confirm that the UPI payment was received" }),
    reference: optionalText(40, "UPI reference"),
  })
  .strict();

const phone = z
  .string()
  .nullish()
  .transform((s, ctx) => {
    try {
      return normalizePhone(s);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number" });
      return z.NEVER;
    }
  });

export const createBillSchema = z
  .object({
    idempotencyKey: uuid.transform((s) => s.toLowerCase()),
    items: z
      .array(item)
      .min(1, "Add at least one item")
      .max(MAX_ITEMS, `A bill can have at most ${MAX_ITEMS} items`)
      .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, {
        message: "Each product can appear only once",
      }),
    discount,
    /**
     * The payable total the cashier's screen displayed. Only compared with the
     * server's total (mismatch: PRICE_CHANGED); never used for calculation.
     */
    expectedTotalPaise: z
      .number()
      .int("Expected total must be a whole number of paise")
      .min(0, "Expected total cannot be negative")
      .max(MAX_EXPECTED_TOTAL_PAISE, "Expected total is too large"),
    payment: z.discriminatedUnion("method", [cashPayment, upiPayment]),
    customerName: optionalText(60, "Customer name"),
    customerPhone: phone,
  })
  .strict();

export type CreateBillInput = z.input<typeof createBillSchema>;
export type ParsedCreateBillInput = z.output<typeof createBillSchema>;
