import { z } from "zod";

/** Strictly YYYY-MM-DD and a real calendar date (2026-02-30 is rejected, not passed to the database). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "Not a valid date");

export const billQuerySchema = z
  .object({
    search: z.string().max(40, "Search is at most 40 characters").optional(),
    date: isoDate.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    status: z.enum(["COMPLETED", "CANCELLED"]).optional(),
    method: z.enum(["CASH", "UPI"]).optional(),
    page: z.number().int("Page must be a whole number").min(1, "Page must be at least 1").default(1),
    pageSize: z
      .number()
      .int("Page size must be a whole number")
      .min(1, "Page size must be at least 1")
      .max(100, "Page size is at most 100")
      .default(25),
  })
  .strict();

export const cancelReasonSchema = z
  .string()
  .trim()
  .min(3, "Give a reason of at least 3 characters")
  .max(200, "The reason is at most 200 characters");

export type BillQuery = z.input<typeof billQuerySchema>;
