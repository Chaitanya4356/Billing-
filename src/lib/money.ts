/** Integer division rounding half up. Requires n >= 0 and d > 0. */
export function roundDiv(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

const DECIMAL = /^\d+(\.\d{1,2})?$/;

/** Parses a non-negative decimal with up to 2 places into hundredths, by string splitting. */
function parseHundredths(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (!DECIMAL.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(value) ? value : null;
}

export function rupeesToPaise(input: string): number | null {
  return parseHundredths(input);
}

/** Percent (0 < p <= 100, up to 2 decimals) to basis points. */
export function percentToBp(input: string): number | null {
  const bp = parseHundredths(input);
  return bp === null || bp <= 0 || bp > 10000 ? null : bp;
}

const rupeeFormat = new Intl.NumberFormat("en-IN");

export function formatPaise(paise: number): string {
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  return `${paise < 0 ? "-" : ""}₹${rupeeFormat.format(rupees)}.${rem}`;
}
