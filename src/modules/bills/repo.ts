import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { billItems, bills, payments } from "@/db/schema";
import { isUuid } from "@/modules/catalog/schema";
import type { BillDetail, GstSnapshot, ShopSnapshot } from "./types";

/**
 * The stored bill with its items (cart order) and payment, scoped by shop.
 * Reads only stored data, so a reprint never depends on current settings or
 * catalog. Null when the bill does not exist in this shop.
 */
export async function getBillDetail(executor: DbOrTx, shopId: string, billId: string): Promise<BillDetail | null> {
  if (!isUuid(billId)) return null;
  const [bill] = await executor
    .select()
    .from(bills)
    .where(and(eq(bills.id, billId), eq(bills.shopId, shopId)));
  if (!bill) return null;

  const items = await executor
    .select({
      productName: billItems.productName,
      categoryName: billItems.categoryName,
      unitPricePaise: billItems.unitPricePaise,
      quantity: billItems.quantity,
      lineTotalPaise: billItems.lineTotalPaise,
    })
    .from(billItems)
    .where(and(eq(billItems.billId, billId), eq(billItems.shopId, shopId)))
    .orderBy(asc(billItems.sortOrder), asc(billItems.id));

  const [payment] = await executor
    .select({
      method: payments.method,
      amountPaise: payments.amountPaise,
      cashTenderedPaise: payments.cashTenderedPaise,
      changePaise: payments.changePaise,
      upiReference: payments.upiReference,
      status: payments.status,
    })
    .from(payments)
    .where(and(eq(payments.billId, billId), eq(payments.shopId, shopId)))
    .orderBy(asc(payments.createdAt), asc(payments.id))
    .limit(1);
  if (!payment) throw new Error(`bill ${billId} has no payment row`);

  return {
    id: bill.id,
    billNumber: bill.billNumber,
    billNumberDisplay: bill.billNumberDisplay,
    tokenNumber: bill.tokenNumber,
    businessDate: bill.businessDate,
    status: bill.status,
    createdAt: bill.createdAt,
    items,
    subtotalPaise: bill.subtotalPaise,
    discountType: bill.discountType,
    discountValue: bill.discountValue,
    discountPaise: bill.discountPaise,
    taxablePaise: bill.taxablePaise,
    cgstPaise: bill.cgstPaise,
    sgstPaise: bill.sgstPaise,
    taxPaise: bill.taxPaise,
    taxIncluded: bill.taxIncluded,
    roundOffPaise: bill.roundOffPaise,
    totalPaise: bill.totalPaise,
    payment,
    customerName: bill.customerName,
    customerPhone: bill.customerPhone,
    printCount: bill.printCount,
    cancelledAt: bill.cancelledAt,
    cancelReason: bill.cancelReason,
    shopSnapshot: bill.shopSnapshot as ShopSnapshot,
    gstSnapshot: bill.gstSnapshot as GstSnapshot,
  };
}
