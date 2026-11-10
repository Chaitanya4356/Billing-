export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "LOCKED"
  | "CONFLICT"
  | "PRICE_CHANGED"
  | "INVALID_PRODUCT"
  | "DISCOUNT_LIMIT"
  | "INSUFFICIENT_CASH"
  | "TOTAL_NOT_POSITIVE"
  | "ALREADY_CANCELLED"
  | "CANCEL_NOT_ALLOWED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

const SAFE_NAME = /^[A-Za-z0-9_$.]{1,64}$/;
const SAFE_CODE = /^[A-Za-z0-9_]{1,32}$/;

/**
 * A log-safe summary of a caught error: its name and, if present, the first
 * short `code` found on it or along its `.cause` chain (e.g. the Postgres
 * SQLSTATE "23505" under a drizzle query error, or "ECONNREFUSED"). Never the
 * message, stack, SQL or bound parameters: those can contain password hashes,
 * customer phone numbers or UPI references.
 */
export function describeError(e: unknown): { name: string; code?: string } {
  let name: string;
  if (e instanceof Error) name = SAFE_NAME.test(e.name) ? e.name : "Error";
  else name = e === null ? "null" : typeof e;

  const seen = new Set<unknown>();
  let current: unknown = e;
  for (let depth = 0; depth < 10 && typeof current === "object" && current !== null && !seen.has(current); depth++) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && SAFE_CODE.test(code)) return { name, code };
    current = (current as { cause?: unknown }).cause;
  }
  return { name };
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    console.error("[action] unhandled error", describeError(e));
    return { ok: false, error: { code: "INTERNAL", message: "Something went wrong" } };
  }
}
