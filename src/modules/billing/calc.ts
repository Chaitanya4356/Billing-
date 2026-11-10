import { AppError } from "@/lib/errors";
import { roundDiv } from "@/lib/money";

/** FLAT: value in paise. PERCENT: value in basis points (1..10000). */
export type DiscountInput = { type: "FLAT" | "PERCENT"; value: number } | null;

export interface CalcInput {
  lines: { unitPricePaise: number; quantity: number }[];
  discount: DiscountInput;
  gst: { enabled: boolean; rateBp: number; inclusive: boolean };
  roundToRupee: boolean;
}

export interface Totals {
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
}

const MAX_QUANTITY = 999;
/**
 * Ten million rupees. Paise columns are Postgres `integer` (max 2,147,483,647):
 * even at 100% exclusive GST the largest derived amount is
 * 2 * 1_000_000_000 + 50 (round-off), which fits. It also keeps every
 * intermediate product (net * 10000, doubled in roundDiv) far inside 2^53.
 */
export const MAX_SUBTOTAL_PAISE = 1_000_000_000;

function invalid(message: string): never {
  throw new AppError("VALIDATION", message);
}

function validate(input: CalcInput): number {
  if (!Array.isArray(input.lines) || input.lines.length === 0) invalid("At least one line is required");

  let subtotal = 0;
  for (const line of input.lines) {
    if (!Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
      invalid("Unit price must be a non-negative integer number of paise");
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      invalid(`Quantity must be an integer between 1 and ${MAX_QUANTITY}`);
    }
    subtotal += line.unitPricePaise * line.quantity;
    if (!Number.isSafeInteger(subtotal) || subtotal > MAX_SUBTOTAL_PAISE) invalid("Bill amount is too large");
  }

  const { discount, gst } = input;
  if (discount !== null) {
    if (!Number.isInteger(discount.value)) invalid("Discount value must be an integer");
    if (discount.type === "PERCENT") {
      if (discount.value < 1 || discount.value > 10000) invalid("Percent discount must be between 0.01% and 100%");
    } else if (discount.type === "FLAT") {
      if (discount.value < 1) invalid("Flat discount must be positive");
      if (discount.value > subtotal) invalid("Flat discount cannot exceed the subtotal");
    } else {
      invalid("Unknown discount type");
    }
  }

  if (gst.enabled && (!Number.isInteger(gst.rateBp) || gst.rateBp < 0 || gst.rateBp > 10000)) {
    invalid("GST rate must be an integer number of basis points between 0 and 10000");
  }

  return subtotal;
}

export function calculateTotals(input: CalcInput): Totals {
  const subtotalPaise = validate(input);
  const { discount, gst } = input;

  let discountPaise = 0;
  if (discount !== null) {
    discountPaise = discount.type === "PERCENT" ? roundDiv(subtotalPaise * discount.value, 10000) : discount.value;
  }
  const net = subtotalPaise - discountPaise;

  let taxPaise = 0;
  let taxablePaise = net;
  let preRoundTotal = net;
  if (gst.enabled) {
    if (gst.inclusive) {
      taxPaise = net - roundDiv(net * 10000, 10000 + gst.rateBp);
      taxablePaise = net - taxPaise;
    } else {
      taxPaise = roundDiv(net * gst.rateBp, 10000);
      preRoundTotal = net + taxPaise;
    }
  }
  const cgstPaise = Math.floor(taxPaise / 2);
  const sgstPaise = taxPaise - cgstPaise;

  const roundOffPaise = input.roundToRupee ? roundDiv(preRoundTotal, 100) * 100 - preRoundTotal : 0;
  const totalPaise = preRoundTotal + roundOffPaise;
  if (totalPaise <= 0) throw new AppError("TOTAL_NOT_POSITIVE", "Bill total must be greater than zero");

  return { subtotalPaise, discountPaise, taxablePaise, cgstPaise, sgstPaise, taxPaise, roundOffPaise, totalPaise };
}
