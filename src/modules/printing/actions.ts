"use server";

import { runAction, type ActionResult } from "@/lib/errors";
import { requireContext } from "@/modules/auth/guards";
import { prepareReceiptPrint } from "./service";

/**
 * Records a print of the bill (the first is the original, later ones are
 * REPRINT) and returns the receipt HTML. Both roles; the bills service
 * enforces what a cashier may read.
 */
export async function printBillAction(billId: string): Promise<ActionResult<{ html: string; isReprint: boolean }>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER", "CASHIER"]);
    return prepareReceiptPrint(ctx, billId);
  });
}
