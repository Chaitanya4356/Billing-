import { z } from "zod";

export const MAX_PRICE_PAISE = 10_000_000;
const MAX_SORT_ORDER = 1_000_000;

const name = z.string().trim().min(1, "Name is required").max(60, "Name is at most 60 characters");

const pricePaise = z
  .number({ error: "Enter a valid price" })
  .int("Price must be a whole number of paise")
  .min(0, "Price cannot be negative")
  .max(MAX_PRICE_PAISE, "Price is too high (maximum ₹1,00,000)");

const sortOrder = z
  .number({ error: "Sort order must be a number" })
  .int("Sort order must be a whole number")
  .min(0, "Sort order cannot be negative")
  .max(MAX_SORT_ORDER, "Sort order is too large");

/** Blank clears the short code (null); anything else is 1-10 letters or digits. */
const shortCode = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : s))
  .or(z.null())
  .pipe(
    z
      .string()
      .max(10, "Short code is at most 10 characters")
      .regex(/^[A-Za-z0-9]+$/, "Short code can only have letters and digits")
      .nullable(),
  );

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id");

export const createCategorySchema = z.object({ name, sortOrder: sortOrder.optional() }).strict();

export const updateCategorySchema = z.object({ name: name.optional(), sortOrder: sortOrder.optional() }).strict();

export const createProductSchema = z
  .object({
    name,
    categoryId: uuid,
    pricePaise,
    shortCode: shortCode.optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict();

export const updateProductSchema = z
  .object({
    name: name.optional(),
    categoryId: uuid.optional(),
    pricePaise: pricePaise.optional(),
    shortCode: shortCode.optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict();

export const listProductsQuerySchema = z
  .object({
    categoryId: uuid.optional(),
    search: z.string().max(100).optional(),
    includeInactive: z.boolean().optional(),
  })
  .strict();

export const isUuid = (s: string): boolean => uuid.safeParse(s).success;

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;
export type CreateProductInput = z.input<typeof createProductSchema>;
export type UpdateProductInput = z.input<typeof updateProductSchema>;
export type ListProductsQuery = z.input<typeof listProductsQuerySchema>;
