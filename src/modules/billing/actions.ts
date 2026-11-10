"use server";

import { runAction, type ActionResult } from "@/lib/errors";
import { requireContext } from "@/modules/auth/guards";
import type { BillDetail } from "@/modules/bills/types";
import { listProducts } from "@/modules/catalog/service";
import { getBillingConfig, type BillingConfig } from "@/modules/shop/service";
import type { CreateBillInput } from "./schema";
import { createBill } from "./service";

// Thin wrappers: authenticate, call the service (which checks the role and
// Zod-validates the input). No redirects in here: runAction would swallow them.

/** Charges a bill. The input is untrusted; createBill parses it with createBillSchema. */
export async function createBillAction(input: unknown): Promise<ActionResult<BillDetail>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER", "CASHIER"]);
    return createBill(ctx, input as CreateBillInput);
  });
}

/**
 * The current billing config and the current prices of the shop's active
 * products, so the billing screen can recalculate after PRICE_CHANGED.
 */
export async function refreshBillingDataAction(): Promise<
  ActionResult<{ config: BillingConfig; products: { id: string; pricePaise: number }[] }>
> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER", "CASHIER"]);
    const [config, products] = await Promise.all([getBillingConfig(ctx), listProducts(ctx)]);
    return { config, products: products.map((p) => ({ id: p.id, pricePaise: p.pricePaise })) };
  });
}
