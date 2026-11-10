/**
 * Every audit action, in one place. Pure (no database import) so the viewer's
 * filter, the label map and unit tests can use it. service.ts re-exports it.
 */
export const AUDIT_ACTIONS = [
  "LOGIN_FAILED",
  "LOGIN_LOCKED",
  "BILL_CREATED",
  "BILL_PRINTED",
  "BILL_REPRINTED",
  "BILL_CANCELLED",
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_PRICE_CHANGED",
  "PRODUCT_DISABLED",
  "CATEGORY_CHANGED",
  "SETTINGS_CHANGED",
  "USER_CREATED",
  "USER_PASSWORD_RESET",
  "USER_DEACTIVATED",
  "USER_REACTIVATED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}
