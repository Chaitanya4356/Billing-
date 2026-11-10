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

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    console.error(e);
    return { ok: false, error: { code: "INTERNAL", message: "Something went wrong" } };
  }
}
