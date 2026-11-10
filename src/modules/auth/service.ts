import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { sessions, shops, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/types";
import { recordAudit } from "@/modules/audit/service";
import { verifyPassword } from "./password";
import { createSession } from "./session";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

const INVALID_CREDENTIALS = "Invalid username or password";
const LOCKED_MESSAGE = "Too many failed attempts. Account locked, try again later.";

// Inputs beyond these lengths cannot be valid and are rejected before hashing,
// so a huge password cannot be used to burn CPU in argon2.
const MAX_USERNAME_LENGTH = 100;
const MAX_PASSWORD_LENGTH = 256;

// A valid argon2id hash of a throwaway string. Verifying against it when the
// username does not exist makes that path cost the same as a wrong password.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$mEbMpQuBnh6vSz7ARk37Dg$FY/Vbnqk3iUoAYcTJoRE8TuvCSsujZ4UyY5t74/U/EY";

/** verifyPassword throws on a malformed hash; treat that as a mismatch. */
async function safeVerify(password: string, hash: string): Promise<boolean> {
  try {
    return await verifyPassword(password, hash);
  } catch {
    return false;
  }
}

/**
 * Short transactions only (no argon2 inside), and never wait long on a row
 * lock: the row is only held for the duration of one UPDATE + audit insert.
 */
async function shortTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    return fn(tx);
  });
}

/** SQL predicate: the account is not locked at `now`. */
function notLockedAt(now: Date) {
  return or(isNull(users.lockedUntil), lte(users.lockedUntil, now));
}

/**
 * Single-shop login: the shop is the first row of `shops`, the username is
 * matched lowercased within it. Throws UNAUTHENTICATED (same message for an
 * unknown user, wrong password or inactive user) or LOCKED.
 *
 * argon2 runs with no transaction open and no row lock held. The outcome is
 * then applied with a single conditional UPDATE guarded by "not locked at
 * now"; those UPDATEs are the authority on lockout, so concurrent attempts
 * cannot exceed MAX_FAILED_ATTEMPTS guesses and a correct password cannot
 * succeed once a concurrent failure has locked the account. The success
 * UPDATE also requires the verified hash and is_active = true, so a password
 * reset or deactivation that lands while argon2 runs yields no session.
 */
export async function login(
  username: string,
  password: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date; ctx: AuthContext }> {
  const uname = String(username ?? "").trim().toLowerCase();
  const pw = String(password ?? "");

  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .orderBy(asc(shops.createdAt), asc(shops.id))
    .limit(1);

  if (!shop || uname.length === 0 || uname.length > MAX_USERNAME_LENGTH || pw.length > MAX_PASSWORD_LENGTH) {
    await safeVerify(pw.slice(0, MAX_PASSWORD_LENGTH), DUMMY_HASH);
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.shopId, shop.id), eq(users.username, uname)))
    .limit(1);

  if (!user) {
    await safeVerify(pw, DUMMY_HASH);
    await recordAudit(db, {
      shopId: shop.id,
      userId: null,
      action: "LOGIN_FAILED",
      entityType: "user",
      entityId: null,
      meta: { username: uname },
    });
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  const rejectLocked = async (lockedUntil: Date | null): Promise<never> => {
    await recordAudit(db, {
      shopId: user.shopId,
      userId: user.id,
      action: "LOGIN_LOCKED",
      entityType: "user",
      entityId: user.id,
      meta: {
        username: uname,
        reason: "ALREADY_LOCKED",
        ...(lockedUntil ? { lockedUntil: lockedUntil.toISOString() } : {}),
      },
    });
    throw new AppError("LOCKED", LOCKED_MESSAGE);
  };

  // Unlocked read, only to skip argon2 work for an already-locked account.
  // The password is not checked here, so LOCKED reveals nothing about it.
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await rejectLocked(user.lockedUntil);
  }

  const passwordOk = await safeVerify(pw, user.passwordHash);

  if (!user.isActive) {
    await recordAudit(db, {
      shopId: user.shopId,
      userId: user.id,
      action: "LOGIN_FAILED",
      entityType: "user",
      entityId: user.id,
      meta: { username: uname, reason: "INACTIVE" },
    });
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  if (!passwordOk) {
    const lockUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
    // In SET, column references read the pre-update row. On reaching the
    // threshold the counter restarts at 0 and the lock window is set.
    const reachesLimit = sql`${users.failedAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS}`;
    const result = await shortTx(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          failedAttempts: sql`CASE WHEN ${reachesLimit} THEN 0 ELSE ${users.failedAttempts} + 1 END`,
          lockedUntil: sql`CASE WHEN ${reachesLimit} THEN ${lockUntil.toISOString()}::timestamptz ELSE ${users.lockedUntil} END`,
        })
        .where(and(eq(users.id, user.id), notLockedAt(now)))
        .returning({ failedAttempts: users.failedAttempts, lockedUntil: users.lockedUntil });
      if (!row) return { kind: "locked" as const };

      const lockedNow = !!row.lockedUntil && row.lockedUntil.getTime() > now.getTime();
      await recordAudit(tx, {
        shopId: user.shopId,
        userId: user.id,
        action: "LOGIN_FAILED",
        entityType: "user",
        entityId: user.id,
        meta: { username: uname, failedAttempts: lockedNow ? MAX_FAILED_ATTEMPTS : row.failedAttempts },
      });
      if (lockedNow) {
        await recordAudit(tx, {
          shopId: user.shopId,
          userId: user.id,
          action: "LOGIN_LOCKED",
          entityType: "user",
          entityId: user.id,
          meta: { username: uname, reason: "THRESHOLD", lockedUntil: row.lockedUntil!.toISOString() },
        });
        return { kind: "lockedNow" as const };
      }
      return { kind: "invalid" as const };
    });
    // Thrown after commit so the audit rows persist.
    if (result.kind === "locked") await rejectLocked(null);
    if (result.kind === "lockedNow") throw new AppError("LOCKED", LOCKED_MESSAGE);
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  const outcome = await shortTx(async (tx) => {
    // Same not-locked guard: a correct guess racing a concurrent lock loses.
    // The row must also still carry the hash that was just verified and still
    // be active: a password reset or deactivation that committed while argon2
    // ran (and revoked the sessions) must not be followed by a new session.
    const [row] = await tx
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(
        and(
          eq(users.id, user.id),
          notLockedAt(now),
          eq(users.passwordHash, user.passwordHash),
          eq(users.isActive, true),
        ),
      )
      .returning({ id: users.id });
    if (!row) {
      const [fresh] = await tx
        .select({ lockedUntil: users.lockedUntil })
        .from(users)
        .where(eq(users.id, user.id));
      const locked = !!fresh?.lockedUntil && fresh.lockedUntil.getTime() > now.getTime();
      return { kind: locked ? ("locked" as const) : ("changed" as const) };
    }
    // Lazily drop this user's expired sessions.
    await tx.delete(sessions).where(and(eq(sessions.userId, user.id), lte(sessions.expiresAt, now)));
    return { kind: "ok" as const, session: await createSession(tx, user.id, now) };
  });
  if (outcome.kind === "locked") await rejectLocked(null);
  if (outcome.kind !== "ok") {
    await recordAudit(db, {
      shopId: user.shopId,
      userId: user.id,
      action: "LOGIN_FAILED",
      entityType: "user",
      entityId: user.id,
      meta: { username: uname, reason: "CHANGED_DURING_LOGIN" },
    });
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  return {
    token: outcome.session.token,
    expiresAt: outcome.session.expiresAt,
    ctx: { shopId: user.shopId, userId: user.id, role: user.role },
  };
}
