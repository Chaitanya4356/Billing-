import { calculateTotals } from "@/modules/billing/calc";
import type { ReceiptData } from "./receipt";

/** What the sample needs to know about the shop (a subset of the settings page's shop info). */
export interface SampleShop {
  name: string;
  address: string;
  phone: string;
  gstin: string | null;
}

/** Optional receipt-related settings so the preview mirrors the owner's configured layout. */
export interface SampleSettings {
  receiptTitle: string;
  gstEnabled: boolean;
  gstRateBp: number;
  gstInclusive: boolean;
}

const SAMPLE_ITEMS = [
  { name: "Masala Chai", quantity: 2, unitPricePaise: 1500 },
  { name: "Samosa", quantity: 2, unitPricePaise: 2000 },
  { name: "Biscuits", quantity: 1, unitPricePaise: 1000 },
];
const SAMPLE_DISCOUNT_PAISE = 500;

/**
 * A fixed, realistic receipt for previewing and test-printing. Pure: no database,
 * no clock, no randomness. Totals come from calculateTotals, never hand-typed.
 * Without `settings` it is a neutral sample (no title, no GST).
 */
export function sampleReceiptData(
  shop: SampleShop,
  text: { header: string; footer: string },
  settings?: SampleSettings,
): ReceiptData {
  const gst = {
    enabled: settings?.gstEnabled ?? false,
    rateBp: settings?.gstRateBp ?? 0,
    inclusive: settings?.gstInclusive ?? false,
  };
  const totals = calculateTotals({
    lines: SAMPLE_ITEMS.map((i) => ({ unitPricePaise: i.unitPricePaise, quantity: i.quantity })),
    discount: { type: "FLAT", value: SAMPLE_DISCOUNT_PAISE },
    gst,
    roundToRupee: false,
  });
  // Customer hands over the next full 100 rupees.
  const cashTenderedPaise = Math.ceil(totals.totalPaise / 10000) * 10000;

  return {
    isSample: true,
    isReprint: false,
    status: "COMPLETED",
    shop: { name: shop.name, address: shop.address, phone: shop.phone, gstin: shop.gstin },
    title: settings?.receiptTitle ?? "",
    header: text.header,
    footer: text.footer,
    billNumberDisplay: "SAMPLE-000001",
    tokenNumber: 42,
    dateTime: "10 Nov 2026, 12:30 pm",
    items: SAMPLE_ITEMS.map((i) => ({ ...i, lineTotalPaise: i.unitPricePaise * i.quantity })),
    subtotalPaise: totals.subtotalPaise,
    discountPaise: totals.discountPaise,
    gst: gst.enabled
      ? {
          inclusive: gst.inclusive,
          rateBp: gst.rateBp,
          taxablePaise: totals.taxablePaise,
          cgstPaise: totals.cgstPaise,
          sgstPaise: totals.sgstPaise,
        }
      : null,
    roundOffPaise: totals.roundOffPaise,
    totalPaise: totals.totalPaise,
    paymentMethod: "CASH",
    cashTenderedPaise,
    changePaise: cashTenderedPaise - totals.totalPaise,
    customerName: null,
  };
}
