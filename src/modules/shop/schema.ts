import { z } from "zod";

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const INT32_MAX = 2_147_483_647;

/** Blank or null clears the GSTIN; anything else must be a well-formed GSTIN. */
const gstin = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : s))
  .or(z.null())
  .pipe(z.string().regex(GSTIN, "Enter a valid 15-character GSTIN").nullable());

/**
 * Partial update of the shop profile (`shops`) and `shop_settings`.
 * Strict: unknown keys (shopId, timezone, ...) are rejected, never ignored.
 */
export const settingsPatchSchema = z
  .object({
    // shops
    name: z.string().trim().min(1, "Shop name is required").max(80, "Shop name is at most 80 characters"),
    address: z.string().trim().max(300, "Address is at most 300 characters"),
    phone: z.string().trim().max(20, "Phone is at most 20 characters"),
    gstin,
    // shop_settings
    receiptHeader: z.string().max(200, "Receipt header is at most 200 characters"),
    receiptFooter: z.string().max(200, "Receipt footer is at most 200 characters"),
    paperWidth: z.union([z.literal(58), z.literal(80)], { error: "Paper width must be 58 or 80" }),
    billPrefix: z
      .string()
      .regex(/^[A-Z0-9]{1,6}$/, "Bill prefix is 1-6 characters: capital letters and digits"),
    tokenResetMode: z.enum(["DAILY", "NEVER"]),
    dayStartHour: z.number().int().min(0).max(23),
    gstEnabled: z.boolean(),
    gstRateBp: z.number().int().min(0).max(10000),
    gstInclusive: z.boolean(),
    receiptTitle: z.string().trim().min(1, "Receipt title is required").max(60),
    roundToRupee: z.boolean(),
    cashierDiscountMaxPctBp: z.number().int().min(0).max(10000),
    cashierDiscountMaxFlatPaise: z.number().int().min(0).max(INT32_MAX),
    cashierCanCancel: z.boolean(),
  })
  .partial()
  .strict();

export type SettingsPatch = z.input<typeof settingsPatchSchema>;
export type ParsedSettingsPatch = z.output<typeof settingsPatchSchema>;
