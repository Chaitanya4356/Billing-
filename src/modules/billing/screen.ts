// Pure helpers for the billing screen (client-safe: no server imports).

import { formatPaise, percentToBp, rupeesToPaise } from "@/lib/money";
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

/** What the cashier submitted, for comparing with the bill the server returned. */
export interface SubmittedBill {
  method: "CASH" | "UPI";
  items: { name: string; quantity: number; unitPricePaise: number }[];
  expectedTotalPaise: number;
}

/** The parts of a returned BillDetail that the replay check compares. */
export interface ReturnedBill {
  payment: { method: "CASH" | "UPI" };
  items: { productName: string; quantity: number; unitPricePaise: number }[];
  totalPaise: number;
}

function itemKey(name: string, quantity: number, unitPricePaise: number): string {
  return JSON.stringify([name, quantity, unitPricePaise]);
}

/**
 * Differences (other than the total) between what was submitted and the bill
 * the server returned. Non-empty only for an idempotent replay: an earlier
 * attempt with the same key was saved (e.g. its response was lost) and the
 * cashier changed the payment method or the items before charging again.
 * Items are compared as a multiset of (name, quantity, unit price); order is irrelevant.
 */
export function describeReplayMismatch(submitted: SubmittedBill, bill: ReturnedBill): string[] {
  const out: string[] = [];
  if (bill.payment.method !== submitted.method) {
    out.push(`Saved as ${bill.payment.method} but you chose ${submitted.method}.`);
  }
  const counts = new Map<string, number>();
  for (const i of submitted.items) {
    const k = itemKey(i.name, i.quantity, i.unitPricePaise);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let itemsDiffer = bill.items.length !== submitted.items.length;
  for (const i of bill.items) {
    if (itemsDiffer) break;
    const k = itemKey(i.productName, i.quantity, i.unitPricePaise);
    const n = counts.get(k) ?? 0;
    if (n === 0) itemsDiffer = true;
    else counts.set(k, n - 1);
  }
  if (itemsDiffer) out.push("Saved items differ from the cart.");
  return out;
}

/**
 * The success-screen warning for a replayed bill, or null when the returned
 * bill matches what was submitted. A total-only difference keeps its original
 * wording; any other difference also says what differs and how to correct it.
 */
export function replayWarning(submitted: SubmittedBill, bill: ReturnedBill): string | null {
  const diffs = describeReplayMismatch(submitted, bill);
  const totalDiffers = bill.totalPaise !== submitted.expectedTotalPaise;
  const totalText = `with a total of ${formatPaise(bill.totalPaise)} (the screen showed ${formatPaise(submitted.expectedTotalPaise)}). Collect ${formatPaise(bill.totalPaise)}.`;
  if (diffs.length === 0) {
    return totalDiffers ? `This bill was already saved by an earlier attempt, ${totalText}` : null;
  }
  const parts = ["This bill was already saved by an earlier attempt and differs from what you entered:", ...diffs];
  if (totalDiffers) parts.push(`It was saved ${totalText}`);
  parts.push("Review it, and if it is wrong, cancel it from Bills and charge again.");
  return parts.join(" ");
}
