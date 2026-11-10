import type { DbOrTx } from "@/db/client";
import { auditLogs } from "@/db/schema";

export type AuditAction =
  | "LOGIN_FAILED"
  | "LOGIN_LOCKED"
  | "BILL_CREATED"
  | "BILL_PRINTED"
  | "BILL_REPRINTED"
  | "BILL_CANCELLED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PRODUCT_PRICE_CHANGED"
  | "PRODUCT_DISABLED"
  | "CATEGORY_CHANGED"
  | "SETTINGS_CHANGED"
  | "USER_CREATED"
  | "USER_PASSWORD_RESET"
  | "USER_DEACTIVATED"
  | "USER_REACTIVATED";

export interface AuditEntry {
  shopId: string;
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Appends one audit row using the given executor. Pass a transaction so the
 * audit row commits or rolls back together with the change it describes.
 */
export async function recordAudit(executor: DbOrTx, e: AuditEntry): Promise<void> {
  await executor.insert(auditLogs).values({
    shopId: e.shopId,
    userId: e.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    meta: e.meta ?? {},
  });
}
