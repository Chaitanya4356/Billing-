import type { AuditAction } from "./actions";

/** Human-readable name of each audit action. Typed as a full Record, so a new action without a label fails to compile. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN_FAILED: "Login failed",
  LOGIN_LOCKED: "Account locked",
  BILL_CREATED: "Bill created",
  BILL_PRINTED: "Bill printed",
  BILL_REPRINTED: "Bill reprinted",
  BILL_CANCELLED: "Bill cancelled",
  PRODUCT_CREATED: "Product created",
  PRODUCT_UPDATED: "Product updated",
  PRODUCT_PRICE_CHANGED: "Product price changed",
  PRODUCT_DISABLED: "Product disabled",
  CATEGORY_CHANGED: "Category changed",
  SETTINGS_CHANGED: "Settings changed",
  USER_CREATED: "User created",
  USER_PASSWORD_RESET: "Password reset",
  USER_DEACTIVATED: "User deactivated",
  USER_REACTIVATED: "User reactivated",
};

/** The label of an action, or the raw value for one this build does not know (old or future rows). */
export function auditActionLabel(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string | undefined>)[action] ?? action;
}
