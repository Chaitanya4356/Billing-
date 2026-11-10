"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/errors";
import { requireContext } from "@/modules/auth/guards";
import type { BillQuery } from "./schema";
import { cancelBill, getBill, listBills, type BillListRow } from "./service";
import type { BillDetail } from "./types";

// Thin wrappers: authenticate, call the service (which checks the role,
// validates the input and enforces the cashier's today-only view). No
// redirects in here.

export async function listBillsAction(
  query: BillQuery,
): Promise<ActionResult<{ rows: BillListRow[]; total: number }>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER", "CASHIER"]);
    return listBills(ctx, query);
  });
}

export async function getBillAction(billId: string): Promise<ActionResult<BillDetail>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER", "CASHIER"]);
    return getBill(ctx, billId);
  });
}

export async function cancelBillAction(billId: string, reason: string): Promise<ActionResult<BillDetail>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER", "CASHIER"]);
    const bill = await cancelBill(ctx, billId, reason);
    revalidatePath("/bills");
    return bill;
  });
}
