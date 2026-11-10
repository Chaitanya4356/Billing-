import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "@/db/client";
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

type Outcome =
  | { kind: "ok"; result: { token: string; expiresAt: Date; ctx: AuthContext } }
  | { kind: "invalid" }
  | { kind: "locked" };

/**
 * Single-shop login: the shop is the first row of `shops`, the username is
 * matched lowercased within it. Throws UNAUTHENTICATED (same message for an
 * unknown user, wrong password or inactive user) or LOCKED.
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

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Row lock serialises concurrent attempts on one account so the failure
    // counter cannot be raced past the lockout threshold.
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.shopId, shop.id), eq(users.username, uname)))
      .limit(1)
      .for("update");

    if (!user) {
      await safeVerify(pw, DUMMY_HASH);
      await recordAudit(tx, {
        shopId: shop.id,
        userId: null,
        action: "LOGIN_FAILED",
        entityType: "user",
        entityId: null,
        meta: { username: uname },
      });
      return { kind: "invalid" };
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      await recordAudit(tx, {
        shopId: user.shopId,
        userId: user.id,
        action: "LOGIN_LOCKED",
        entityType: "user",
        entityId: user.id,
        meta: { username: uname, lockedUntil: user.lockedUntil.toISOString() },
      });
      return { kind: "locked" };
    }

    const passwordOk = await safeVerify(pw, user.passwordHash);

    if (!user.isActive) {
      await recordAudit(tx, {
        shopId: user.shopId,
        userId: user.id,
        action: "LOGIN_FAILED",
        entityType: "user",
        entityId: user.id,
        meta: { username: uname, reason: "INACTIVE" },
      });
      return { kind: "invalid" };
    }

    if (!passwordOk) {
      const attempts = user.failedAttempts + 1;
      const lockNow = attempts >= MAX_FAILED_ATTEMPTS;
      const lockedUntil = lockNow ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil;
      // On locking, the counter restarts so the next window gets a fresh 5 tries.
      await tx
        .update(users)
        .set({ failedAttempts: lockNow ? 0 : attempts, lockedUntil })
        .where(eq(users.id, user.id));
      await recordAudit(tx, {
        shopId: user.shopId,
        userId: user.id,
        action: "LOGIN_FAILED",
        entityType: "user",
        entityId: user.id,
        meta: { username: uname, failedAttempts: attempts },
      });
      if (lockNow) {
        await recordAudit(tx, {
          shopId: user.shopId,
          userId: user.id,
          action: "LOGIN_LOCKED",
          entityType: "user",
          entityId: user.id,
          meta: { username: uname, lockedUntil: lockedUntil!.toISOString() },
        });
        return { kind: "locked" };
      }
      return { kind: "invalid" };
    }

    await tx
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(users.id, user.id));
    // Lazily drop this user's expired sessions.
    await tx.delete(sessions).where(and(eq(sessions.userId, user.id), lte(sessions.expiresAt, now)));
    const { token, expiresAt } = await createSession(tx, user.id, now);
    return {
      kind: "ok",
      result: { token, expiresAt, ctx: { shopId: user.shopId, userId: user.id, role: user.role } },
    };
  });

  // Thrown outside the transaction so the audit rows above are committed.
  if (outcome.kind === "locked") throw new AppError("LOCKED", LOCKED_MESSAGE);
  if (outcome.kind === "invalid") throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  return outcome.result;
}
