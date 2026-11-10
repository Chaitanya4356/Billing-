import { percentToBp } from "@/lib/money";

/**
 * Percent field that may legitimately be 0 (percentToBp rejects 0 because a
 * line discount of 0% is meaningless, but a GST rate or a cashier discount
 * limit of 0 is a real setting). Returns basis points, or null when invalid
 * or blank.
 */
export function parseZeroablePercentBp(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (/^0+(\.0{1,2})?$/.test(cleaned)) return 0;
  return percentToBp(input);
}

/** GST rate in percent ("0" allowed) to basis points, or null. */
export const parseGstRateBp = parseZeroablePercentBp;

/** Paise to an editable rupee string: 5000 -> "50", 1250 -> "12.5", 1205 -> "12.05". */
export function paiseToRupeeInput(paise: number): string {
  const whole = Math.floor(paise / 100);
  const frac = String(paise % 100).padStart(2, "0").replace(/0+$/, "");
  return frac === "" ? String(whole) : `${whole}.${frac}`;
}

/** Basis points to an editable percent string: 1800 -> "18", 1250 -> "12.5", 0 -> "0". */
export function bpToPercentInput(bp: number): string {
  return paiseToRupeeInput(bp);
}
