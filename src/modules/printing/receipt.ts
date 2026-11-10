import { formatDateTimeIST } from "@/lib/time";
import type { BillDetail } from "@/modules/bills/types";

export interface ReceiptData {
  isSample: boolean;
  isReprint: boolean;
  status: "COMPLETED" | "CANCELLED";
  shop: { name: string; address: string; phone: string; gstin: string | null };
  title: string;
  header: string;
  footer: string;
  billNumberDisplay: string;
  tokenNumber: number;
  dateTime: string;
  items: { name: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }[];
  subtotalPaise: number;
  discountPaise: number;
  gst: null | {
    inclusive: boolean;
    rateBp: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
  };
  roundOffPaise: number;
  totalPaise: number;
  paymentMethod: "CASH" | "UPI";
  cashTenderedPaise: number | null;
  changePaise: number | null;
  customerName: string | null;
}

/**
 * Builds the printable model from a stored bill. Shop and GST details come from the
 * bill's own snapshots (never from current settings), and tax amounts are the stored
 * ones: nothing is recalculated here.
 */
export function buildReceiptData(
  bill: BillDetail,
  text: { header: string; footer: string },
  opts: { isReprint: boolean },
): ReceiptData {
  const { gstSnapshot } = bill;
  const isCash = bill.payment.method === "CASH";
  return {
    isSample: false,
    isReprint: opts.isReprint,
    status: bill.status,
    shop: {
      name: bill.shopSnapshot.name,
      address: bill.shopSnapshot.address,
      phone: bill.shopSnapshot.phone,
      gstin: bill.shopSnapshot.gstin,
    },
    title: gstSnapshot.title,
    header: text.header,
    footer: text.footer,
    billNumberDisplay: bill.billNumberDisplay,
    tokenNumber: bill.tokenNumber,
    dateTime: formatDateTimeIST(bill.createdAt),
    items: bill.items.map((i) => ({
      name: i.productName,
      quantity: i.quantity,
      unitPricePaise: i.unitPricePaise,
      lineTotalPaise: i.lineTotalPaise,
    })),
    subtotalPaise: bill.subtotalPaise,
    discountPaise: bill.discountPaise,
    gst: gstSnapshot.enabled
      ? {
          inclusive: gstSnapshot.inclusive,
          rateBp: gstSnapshot.rateBp,
          taxablePaise: bill.taxablePaise,
          cgstPaise: bill.cgstPaise,
          sgstPaise: bill.sgstPaise,
        }
      : null,
    roundOffPaise: bill.roundOffPaise,
    totalPaise: bill.totalPaise,
    paymentMethod: bill.payment.method,
    cashTenderedPaise: isCash ? bill.payment.cashTenderedPaise : null,
    changePaise: isCash ? bill.payment.changePaise : null,
    customerName: bill.customerName,
  };
}
