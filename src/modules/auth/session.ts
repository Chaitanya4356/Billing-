import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { sessions, users } from "@/db/schema";
import type { AuthContext } from "@/lib/types";

/** Absolute session lifetime, counted from login. */
export const SESSION_TTL_HOURS = 12;

/** Name of the httpOnly cookie that carries the raw session token. */
export const SESSION_COOKIE = "session";

/** 32 random bytes, base64url. Only ever handed to the client, never stored. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores: the SHA-256 hex digest of the raw token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createSession(
  executor: DbOrTx,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 3_600_000);
  await executor.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    createdAt: now,
  });
  return { token, expiresAt };
}

/**
 * Resolves a raw session token to its AuthContext, or null when the token is
 * unknown, expired (the row is deleted lazily) or belongs to an inactive user.
 */
export async function validateSession(
  token: string,
  now: Date = new Date(),
): Promise<AuthContext | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > 256) return null;
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      shopId: users.shopId,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  if (!row.isActive) return null;
  return { shopId: row.shopId, userId: row.userId, role: row.role };
}

/** Deletes the session for this raw token (no-op if it does not exist). */
export async function logout(token: string): Promise<void> {
  if (typeof token !== "string" || token.length === 0) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Deletes every session of a user (deactivation, password reset). */
export async function revokeUserSessions(userId: string, executor: DbOrTx = db): Promise<void> {
  await executor.delete(sessions).where(eq(sessions.userId, userId));
}
