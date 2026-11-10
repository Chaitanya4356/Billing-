import { randomUUID } from "node:crypto";
import type { CreateBillInput } from "../../src/modules/billing/schema";

export interface CartProduct {
  productId: string;
  pricePaise: number;
}

/**
 * A valid cash CreateBillInput (GST off, no rounding, no discount) for the given
 * lines, with `expectedUnitPricePaise` and `expectedTotalPaise` filled in the way
 * the cashier screen would. Each call gets a fresh idempotency key.
 */
export function cashBillInput(
  lines: Array<CartProduct & { quantity?: number }>,
  over: Partial<CreateBillInput> = {},
): CreateBillInput {
  const items = lines.map((l) => ({
    productId: l.productId,
    quantity: l.quantity ?? 1,
    expectedUnitPricePaise: l.pricePaise,
  }));
  const total = lines.reduce((sum, l) => sum + l.pricePaise * (l.quantity ?? 1), 0);
  return {
    idempotencyKey: randomUUID(),
    items,
    discount: null,
    payment: { method: "CASH", cashTenderedPaise: total },
    expectedTotalPaise: total,
    ...over,
  };
}

export function upiBillInput(
  lines: Array<CartProduct & { quantity?: number }>,
  over: Partial<CreateBillInput> = {},
): CreateBillInput {
  return cashBillInput(lines, { payment: { method: "UPI", confirmed: true, reference: "UTR1" }, ...over });
}
