// Pure helpers for the billing screen (client-safe: no server imports).

import { percentToBp, rupeesToPaise } from "@/lib/money";
import type { CartState } from "./cart";
import type { CreateBillInput } from "./schema";

export type Discount = CartState["discount"];

/**
 * A v4 UUID for the cart's idempotency key. `crypto.randomUUID` only exists
 * in secure contexts (https or localhost); a till opened over plain http on
 * the LAN falls back to `crypto.getRandomValues`, which is always available.
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Discount text as typed (rupees for FLAT, percent for PERCENT). Blank or zero
 * means no discount (null); anything unparseable is an error, never silently
 * dropped (the cashier would otherwise charge without the discount they typed).
 */
export function parseDiscountText(
  type: "FLAT" | "PERCENT",
  text: string,
): { ok: true; discount: Discount } | { ok: false; error: string } {
  if (text.trim() === "") return { ok: true, discount: null };
  if (rupeesToPaise(text) === 0) return { ok: true, discount: null };
  if (type === "FLAT") {
    const paise = rupeesToPaise(text);
    return paise === null
      ? { ok: false, error: "Enter a discount in rupees, like 10 or 12.50" }
      : { ok: true, discount: { type: "FLAT", value: paise } };
  }
  const bp = percentToBp(text);
  return bp === null
    ? { ok: false, error: "Enter a percent between 0 and 100, like 10 or 12.5" }
    : { ok: true, discount: { type: "PERCENT", value: bp } };
}

/** Cash tendered as typed. Blank is `paise: null` (not an error yet); invalid text is an error. */
export function parseCashText(text: string): { ok: true; paise: number | null } | { ok: false; error: string } {
  if (text.trim() === "") return { ok: true, paise: null };
  const paise = rupeesToPaise(text);
  return paise === null ? { ok: false, error: "Enter a valid amount, like 50 or 12.50" } : { ok: true, paise };
}

export interface SearchableProduct {
  id: string;
  name: string;
  shortCode: string | null;
}

/**
 * Case-insensitive name substring or exact short code match, in catalog
 * order, with exact short code matches first. A blank query matches nothing.
 */
export function searchProducts<T extends SearchableProduct>(products: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const byCode = products.filter((p) => p.shortCode !== null && p.shortCode.toLowerCase() === q);
  const byName = products.filter((p) => !byCode.includes(p) && p.name.toLowerCase().includes(q));
  return [...byCode, ...byName];
}

export type PaymentDraft = { method: "CASH"; cashTenderedPaise: number } | { method: "UPI"; reference: string };

/**
 * The request for createBillAction. Prices and the total are what the screen
 * displayed and are only compared by the server, never used to calculate.
 */
export function buildCreateBillInput(args: {
  cart: CartState;
  displayedTotalPaise: number;
  payment: PaymentDraft;
  customerName: string;
  customerPhone: string;
}): CreateBillInput {
  const { cart, payment } = args;
  const name = args.customerName.trim();
  const phone = args.customerPhone.trim();
  const reference = payment.method === "UPI" ? payment.reference.trim() : "";
  return {
    idempotencyKey: cart.idempotencyKey,
    items: cart.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      expectedUnitPricePaise: l.unitPricePaise,
    })),
    discount: cart.discount ? { type: cart.discount.type, value: cart.discount.value } : null,
    expectedTotalPaise: args.displayedTotalPaise,
    payment:
      payment.method === "CASH"
        ? { method: "CASH", cashTenderedPaise: payment.cashTenderedPaise }
        : { method: "UPI", confirmed: true, reference: reference || null },
    customerName: name || null,
    customerPhone: phone || null,
  };
}
