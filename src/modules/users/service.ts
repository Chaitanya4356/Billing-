import { and, asc, eq, sql } from "drizzle-orm";
import type { ZodType } from "zod";
import { db, type Tx } from "@/db/client";
import { users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { AuthContext, Role } from "@/lib/types";
import { recordAudit } from "@/modules/audit/service";
import { assertRole } from "@/modules/auth/guards";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { revokeUserSessions } from "@/modules/auth/session";
import { isUuid } from "@/modules/catalog/schema";
import {
  changeOwnPasswordSchema,
  createCashierSchema,
  resetPasswordSchema,
  setActiveSchema,
  type CreateCashierInput,
} from "./schema";

export interface UserRow {
  id: string;
  name: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}

const userColumns = {
  id: users.id,
  name: users.name,
  username: users.username,
  role: users.role,
  isActive: users.isActive,
  createdAt: users.createdAt,
};

const USERNAME_TAKEN = "That username is already taken";
const USER_NOT_FOUND = "User not found";
const OWNER_TARGET = "The owner account cannot be changed here";
const WRONG_CURRENT = "Current password is incorrect";
const USERNAME_CONSTRAINT = "users_shop_id_username_unique";

function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new AppError("VALIDATION", r.error.issues[0]?.message ?? "Invalid input", r.error.issues);
  }
  return r.data;
}

/** True for the (shop_id, username) unique violation, also when wrapped by drizzle. */
function isUsernameTaken(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const { code, constraint } = cur as { code?: unknown; constraint?: unknown };
    if (code === "23505" && (constraint === undefined || constraint === USERNAME_CONSTRAINT)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Short transactions only: argon2 never runs inside one, and a row lock is
 * never waited on for long.
 */
async function shortTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    return fn(tx);
  });
}

/**
 * Resolves a target for reset/activate: must be a user of the caller's shop
 * (else NOT_FOUND, also for a malformed id) and a CASHIER (an owner, including
 * the caller, is FORBIDDEN).
 */
async function loadCashierTarget(
  executor: typeof db | Tx,
  ctx: AuthContext,
  userId: unknown,
  forUpdate: boolean,
): Promise<{ id: string; isActive: boolean }> {
  if (typeof userId !== "string" || !isUuid(userId)) throw new AppError("NOT_FOUND", USER_NOT_FOUND);
  const q = executor
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.shopId, ctx.shopId)));
  const [row] = forUpdate ? await q.for("update") : await q;
  if (!row) throw new AppError("NOT_FOUND", USER_NOT_FOUND);
  if (row.role !== "CASHIER") throw new AppError("FORBIDDEN", OWNER_TARGET);
  return { id: row.id, isActive: row.isActive };
}

/** The shop's users, owner(s) first, then by name. OWNER only. */
export async function listUsers(ctx: AuthContext): Promise<UserRow[]> {
  assertRole(ctx, ["OWNER"]);
  return db
    .select(userColumns)
    .from(users)
    .where(eq(users.shopId, ctx.shopId))
    .orderBy(sql`CASE WHEN ${users.role} = 'OWNER' THEN 0 ELSE 1 END`, asc(users.name), asc(users.username));
}

/** Creates an active CASHIER in the caller's shop. Duplicate username (any case) => CONFLICT. */
export async function createCashier(ctx: AuthContext, input: CreateCashierInput): Promise<UserRow> {
  assertRole(ctx, ["OWNER"]);
  const i = parseOrThrow(createCashierSchema, input);
  const passwordHash = await hashPassword(i.password);
  try {
    return await shortTx(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({ shopId: ctx.shopId, name: i.name, username: i.username, passwordHash, role: "CASHIER" })
        .returning(userColumns);
      await recordAudit(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        action: "USER_CREATED",
        entityType: "user",
        entityId: row.id,
        meta: { username: row.username },
      });
      return row;
    });
  } catch (e) {
    if (isUsernameTaken(e)) throw new AppError("CONFLICT", USERNAME_TAKEN);
    throw e;
  }
}

/**
 * Sets a cashier's password, clears their lockout and revokes all of their
 * sessions, in one transaction. The new hash is computed before it opens.
 */
export async function resetPassword(ctx: AuthContext, userId: string, newPassword: string): Promise<void> {
  assertRole(ctx, ["OWNER"]);
  const { newPassword: pw } = parseOrThrow(resetPasswordSchema, { newPassword });
  // Cheap pre-check so a bad target does not cost an argon2 hash; the guarded
  // UPDATE below is the authority.
  const target = await loadCashierTarget(db, ctx, userId, false);
  const passwordHash = await hashPassword(pw);
  await shortTx(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ passwordHash, failedAttempts: 0, lockedUntil: null })
      .where(and(eq(users.id, target.id), eq(users.shopId, ctx.shopId), eq(users.role, "CASHIER")))
      .returning({ id: users.id });
    if (!row) throw new AppError("NOT_FOUND", USER_NOT_FOUND);
    await revokeUserSessions(target.id, tx);
    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: "USER_PASSWORD_RESET",
      entityType: "user",
      entityId: target.id,
      meta: {},
    });
  });
}

/**
 * Deactivates (revoking all sessions) or reactivates (clearing the lockout,
 * leaving the password alone) a cashier. Setting the current state again is a
 * no-op apart from re-revoking sessions on deactivation; it is not audited.
 */
export async function setUserActive(ctx: AuthContext, userId: string, active: boolean): Promise<void> {
  assertRole(ctx, ["OWNER"]);
  parseOrThrow(setActiveSchema, { active });
  await shortTx(async (tx) => {
    const target = await loadCashierTarget(tx, ctx, userId, true);
    if (!active) await revokeUserSessions(target.id, tx);
    if (target.isActive === active) return;
    await tx
      .update(users)
      .set(active ? { isActive: true, failedAttempts: 0, lockedUntil: null } : { isActive: false })
      .where(eq(users.id, target.id));
    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
      entityType: "user",
      entityId: target.id,
      meta: {},
    });
  });
}

/**
 * The signed-in owner changes their own password. The current password is
 * verified, and the new one hashed, before any transaction opens; the update
 * is then guarded on the verified hash, so a concurrent change makes this
 * fail instead of overwriting it. Revokes ALL of the user's sessions,
 * including the current one. A wrong current password does not count toward
 * the login lockout and is not audited.
 */
export async function changeOwnPassword(ctx: AuthContext, current: string, next: string): Promise<void> {
  assertRole(ctx, ["OWNER"]);
  const i = parseOrThrow(changeOwnPasswordSchema, { current, next });

  const [me] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, ctx.userId), eq(users.shopId, ctx.shopId), eq(users.isActive, true)));
  if (!me) throw new AppError("UNAUTHENTICATED", WRONG_CURRENT);

  let ok = false;
  try {
    ok = await verifyPassword(i.current, me.passwordHash);
  } catch {
    ok = false; // malformed stored hash
  }
  if (!ok) throw new AppError("UNAUTHENTICATED", WRONG_CURRENT);

  const passwordHash = await hashPassword(i.next);
  await shortTx(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, ctx.userId), eq(users.passwordHash, me.passwordHash), eq(users.isActive, true)))
      .returning({ id: users.id });
    if (!row) throw new AppError("UNAUTHENTICATED", WRONG_CURRENT);
    await revokeUserSessions(ctx.userId, tx);
    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: "USER_PASSWORD_RESET",
      entityType: "user",
      entityId: ctx.userId,
      meta: { self: true },
    });
  });
}
