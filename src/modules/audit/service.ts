import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { auditLogs, shops, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/types";
import { assertRole } from "@/modules/auth/guards";
import { AUDIT_ACTIONS, type AuditAction } from "./actions";

// The action list lives in ./actions (pure, no database import); re-exported here so callers have one entry point.
export { AUDIT_ACTIONS };
export type { AuditAction };

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

/** Strictly YYYY-MM-DD and a real calendar date (2026-02-30 is rejected, not passed to the database). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "Not a valid date");

const auditQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    action: z.enum(AUDIT_ACTIONS, "Unknown action").optional(),
    page: z.number().int("Page must be a whole number").min(1, "Page must be at least 1").default(1),
    pageSize: z
      .number()
      .int("Page size must be a whole number")
      .min(1, "Page size must be at least 1")
      .max(100, "Page size is at most 100")
      .default(50),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, "From date must not be after to date");

export type AuditQuery = z.input<typeof auditQuerySchema>;

export interface AuditRow {
  id: string;
  createdAt: Date;
  /** The acting user's name; null for system events and unknown users (e.g. a failed login for a username that does not exist). */
  userName: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  meta: Record<string, unknown>;
}

/**
 * The shop's audit log, newest first (OWNER only). `from` and `to` are
 * inclusive calendar dates in the shop's own timezone. Every query is scoped
 * by ctx.shopId, including the join to the users table.
 */
export async function listAudit(ctx: AuthContext, q: AuditQuery): Promise<{ rows: AuditRow[]; total: number }> {
  assertRole(ctx, ["OWNER"]);
  const parsed = auditQuerySchema.safeParse(q);
  if (!parsed.success) {
    throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid query", parsed.error.issues);
  }
  const { from, to, action, page, pageSize } = parsed.data;

  const conditions: SQL[] = [eq(auditLogs.shopId, ctx.shopId)];
  if (action) conditions.push(eq(auditLogs.action, action));
  if (from || to) {
    const [shop] = await db.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, ctx.shopId));
    const tz = shop?.timezone ?? "Asia/Kolkata";
    const localDate = sql`(${auditLogs.createdAt} AT TIME ZONE ${tz})::date`;
    if (from) conditions.push(sql`${localDate} >= ${from}::date`);
    if (to) conditions.push(sql`${localDate} <= ${to}::date`);
  }
  const where = and(...conditions);

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        userName: users.name,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        meta: auditLogs.meta,
      })
      .from(auditLogs)
      .leftJoin(users, and(eq(users.id, auditLogs.userId), eq(users.shopId, auditLogs.shopId)))
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r,
      action: r.action as AuditAction,
      meta: r.meta !== null && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as Record<string, unknown>) : {},
    })),
    total: count.total,
  };
}
