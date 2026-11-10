import { AppError } from "@/lib/errors";

/**
 * Normalizes to E.164. Empty input yields null. Accepts a 10-digit Indian
 * number (assumes +91), 91XXXXXXXXXX, or +<country code><number> (10-15 digits).
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input == null) return null;
  const cleaned = input.replace(/[\s\-().]/g, "");
  if (cleaned === "") return null;
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^91\d{10}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;
  throw new AppError("VALIDATION", "Enter a valid phone number");
}
