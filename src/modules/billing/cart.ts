import { AppError } from "@/lib/errors";
import type { BillingConfig } from "@/modules/shop/service";
import { calculateTotals, type Totals } from "./calc";

export interface CartLine {
  productId: string;
  name: string;
  unitPricePaise: number;
  quantity: number;
}

export interface CartState {
  lines: CartLine[];
  discount: { type: "FLAT" | "PERCENT"; value: number } | null;
  idempotencyKey: string;
}

export type CartAction =
  | { type: "ADD_PRODUCT"; product: { id: string; name: string; pricePaise: number } }
  | { type: "SET_QUANTITY"; productId: string; quantity: number }
  | { type: "REMOVE"; productId: string }
  | { type: "SET_DISCOUNT"; discount: CartState["discount"] }
  | { type: "REFRESH_PRICES"; prices: Record<string, number> }
  | { type: "RESET" };

const MAX_QUANTITY = 999;

export function initialCart(newKey: () => string): CartState {
  return { lines: [], discount: null, idempotencyKey: newKey() };
}

function sameDiscount(a: CartState["discount"], b: CartState["discount"]): boolean {
  if (a === null || b === null) return a === b;
  return a.type === b.type && a.value === b.value;
}

export function cartReducer(state: CartState, action: CartAction, newKey: () => string): CartState {
  switch (action.type) {
    case "ADD_PRODUCT": {
      const { product } = action;
      const idx = state.lines.findIndex((l) => l.productId === product.id);
      if (idx === -1) {
        const line: CartLine = {
          productId: product.id,
          name: product.name,
          unitPricePaise: product.pricePaise,
          quantity: 1,
        };
        return { ...state, lines: [...state.lines, line] };
      }
      const existing = state.lines[idx];
      if (existing.quantity >= MAX_QUANTITY) return state;
      const lines = state.lines.slice();
      lines[idx] = { ...existing, quantity: existing.quantity + 1 };
      return { ...state, lines };
    }

    case "SET_QUANTITY": {
      const { productId, quantity } = action;
      if (!Number.isInteger(quantity)) return state;
      const idx = state.lines.findIndex((l) => l.productId === productId);
      if (idx === -1) return state;
      if (quantity <= 0) return { ...state, lines: state.lines.filter((_, i) => i !== idx) };
      const clamped = Math.min(quantity, MAX_QUANTITY);
      if (state.lines[idx].quantity === clamped) return state;
      const lines = state.lines.slice();
      lines[idx] = { ...lines[idx], quantity: clamped };
      return { ...state, lines };
    }

    case "REMOVE": {
      if (!state.lines.some((l) => l.productId === action.productId)) return state;
      return { ...state, lines: state.lines.filter((l) => l.productId !== action.productId) };
    }

    case "SET_DISCOUNT": {
      const d = action.discount;
      // "No discount" is null; a zero / negative / non-integer value is treated as no discount.
      const next = d !== null && Number.isInteger(d.value) && d.value > 0 ? { type: d.type, value: d.value } : null;
      return sameDiscount(state.discount, next) ? state : { ...state, discount: next };
    }

    case "REFRESH_PRICES": {
      let changed = false;
      const lines = state.lines.map((l) => {
        if (!Object.prototype.hasOwnProperty.call(action.prices, l.productId)) return l;
        const price = action.prices[l.productId];
        if (!Number.isInteger(price) || price < 0 || price === l.unitPricePaise) return l;
        changed = true;
        return { ...l, unitPricePaise: price };
      });
      return changed ? { ...state, lines } : state;
    }

    case "RESET":
      return initialCart(newKey);
  }
}

/**
 * Totals for the cart, exactly as `calculateTotals` computes them (the payable
 * total is sent to the server as `expectedTotalPaise`). Returns null for an
 * empty cart or whenever the cart is not (yet) valid; never throws for
 * validation problems.
 */
export function selectTotals(
  state: CartState,
  cfg: Pick<BillingConfig, "gstEnabled" | "gstRateBp" | "gstInclusive" | "roundToRupee">,
): Totals | null {
  if (state.lines.length === 0) return null;
  try {
    return calculateTotals({
      lines: state.lines.map((l) => ({ unitPricePaise: l.unitPricePaise, quantity: l.quantity })),
      discount: state.discount,
      gst: { enabled: cfg.gstEnabled, rateBp: cfg.gstRateBp, inclusive: cfg.gstInclusive },
      roundToRupee: cfg.roundToRupee,
    });
  } catch (err) {
    if (err instanceof AppError) return null;
    throw err;
  }
}
