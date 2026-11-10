import { rupeesToPaise } from "@/lib/money";
import { createProductSchema } from "./schema";

export type ProductFormField = "name" | "price" | "shortCode" | "categoryId";
export type ProductFormErrors = Partial<Record<ProductFormField, string>>;

export interface ProductFormValue {
  name: string;
  categoryId: string;
  pricePaise: number;
  shortCode: string | null;
}

const FIELD_FOR_KEY: Record<string, ProductFormField> = {
  name: "name",
  pricePaise: "price",
  shortCode: "shortCode",
  categoryId: "categoryId",
};

/**
 * Turns the raw add/edit form into a product input, or per-field errors.
 * The price text is rupees ("15", "12.50", "0" all valid); blank or malformed
 * text is an error and nothing should be sent. Everything else is checked by
 * the same Zod schema the server uses.
 */
export function buildProductInput(raw: {
  name: string;
  priceText: string;
  shortCode: string;
  categoryId: string;
}): { value: ProductFormValue } | { errors: ProductFormErrors } {
  const errors: ProductFormErrors = {};
  const paise = rupeesToPaise(raw.priceText);
  if (paise === null) errors.price = "Enter a price in rupees, for example 15 or 12.50";

  const checked = createProductSchema.safeParse({
    name: raw.name,
    categoryId: raw.categoryId,
    pricePaise: paise ?? 0,
    shortCode: raw.shortCode,
  });
  if (!checked.success) {
    for (const issue of checked.error.issues) {
      const field = FIELD_FOR_KEY[String(issue.path[0] ?? "")];
      if (field && !errors[field]) {
        errors[field] = field === "categoryId" ? "Choose a category" : issue.message;
      }
    }
  }
  if (Object.keys(errors).length > 0 || !checked.success || paise === null) return { errors };
  return {
    value: {
      name: checked.data.name,
      categoryId: checked.data.categoryId,
      pricePaise: checked.data.pricePaise,
      shortCode: checked.data.shortCode ?? null,
    },
  };
}
