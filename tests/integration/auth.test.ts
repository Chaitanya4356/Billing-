import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, sessions, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { login } from "@/modules/auth/service";
import {
  SESSION_TTL_HOURS,
  hashToken,
  logout,
  revokeUserSessions,
  validateSession,
} from "@/modules/auth/session";
import { makeShop, resetDb, type TestShop } from "../helpers/db";

const T0 = new Date("2026-11-10T09:00:00.000Z");
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const hours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

async function expectAppError(p: Promise<unknown>, code: string): Promise<AppError> {
  const err = await p.then(
    () => {
      throw new Error(`expected AppError ${code}, but promise resolved`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

async function auditRows(action: string) {
  return db.select().from(auditLogs).where(eq(auditLogs.action, action));
}

async function userRow(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

describe("login", () => {
  let t: TestShop;

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
  });

  it("returns ctx, token and expiry; stores only the SHA-256 hash of the token", async () => {
    const res = await login("owner", "owner-pass-123", T0);
    expect(res.ctx).toEqual(t.owner.ctx);
    expect(res.expiresAt.getTime()).toBe(hours(T0, SESSION_TTL_HOURS).getTime());
    expect(res.token.length).toBeGreaterThanOrEqual(43);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, t.owner.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(res.token);
    expect(rows[0].tokenHash).toBe(hashToken(res.token));
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].expiresAt.getTime()).toBe(res.expiresAt.getTime());
  });

  it("issues a distinct token per login", async () => {
    const a = await login("cashier", "cashier-pass-123", T0);
    const b = await login("cashier", "cashier-pass-123", T0);
    expect(a.token).not.toBe(b.token);
    expect(a.ctx).toEqual(t.cashier.ctx);
  });

  it("matches the username case-insensitively", async () => {
    const res = await login("  OWNER ", "owner-pass-123", T0);
    expect(res.ctx.userId).toBe(t.owner.id);
  });

  it("wrong password and unknown username throw the same UNAUTHENTICATED error and audit LOGIN_FAILED", async () => {
    const wrong = await expectAppError(login("owner", "nope", T0), "UNAUTHENTICATED");
    const unknown = await expectAppError(login("ghost", "nope", T0), "UNAUTHENTICATED");
    expect(wrong.message).toBe("Invalid username or password");
    expect(unknown.message).toBe(wrong.message);

    const rows = await auditRows("LOGIN_FAILED");
    expect(rows).toHaveLength(2);
    const forOwner = rows.find((r) => r.userId === t.owner.id);
    const forGhost = rows.find((r) => r.userId === null);
    expect(forOwner?.shopId).toBe(t.shopId);
    expect(forGhost?.shopId).toBe(t.shopId);
    expect(forGhost?.meta).toEqual({ username: "ghost" });

    expect((await userRow(t.owner.id)).failedAttempts).toBe(1);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("treats a malformed stored hash as a failed login, not a crash", async () => {
    await db.update(users).set({ passwordHash: "not-a-hash" }).where(eq(users.id, t.owner.id));
    await expectAppError(login("owner", "owner-pass-123", T0), "UNAUTHENTICATED");
    expect((await userRow(t.owner.id)).failedAttempts).toBe(1);
  });

  it("locks after 5 wrong passwords, rejects even the correct one, and unlocks after 15 minutes", async () => {
    for (let i = 0; i < 4; i++) {
      await expectAppError(login("owner", `wrong-${i}`, minutes(T0, i)), "UNAUTHENTICATED");
    }
    await expectAppError(login("owner", "wrong-4", minutes(T0, 4)), "LOCKED");
    const locked = await userRow(t.owner.id);
    expect(locked.lockedUntil?.getTime()).toBe(minutes(T0, 4 + 15).getTime());
    expect(await auditRows("LOGIN_LOCKED")).toHaveLength(1);

    // Correct password while locked.
    await expectAppError(login("owner", "owner-pass-123", minutes(T0, 5)), "LOCKED");
    expect(await auditRows("LOGIN_LOCKED")).toHaveLength(2);
    expect(await db.select().from(sessions)).toHaveLength(0);

    // 16 minutes after the lock was set.
    const res = await login("owner", "owner-pass-123", minutes(T0, 4 + 16));
    expect(res.ctx).toEqual(t.owner.ctx);
    const after = await userRow(t.owner.id);
    expect(after.failedAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("a successful login resets the failure counter", async () => {
    for (let i = 0; i < 4; i++) {
      await expectAppError(login("owner", "bad", T0), "UNAUTHENTICATED");
    }
    await login("owner", "owner-pass-123", T0);
    expect((await userRow(t.owner.id)).failedAttempts).toBe(0);
    // Four more failures must not lock (counter was reset).
    for (let i = 0; i < 4; i++) {
      await expectAppError(login("owner", "bad", T0), "UNAUTHENTICATED");
    }
    expect((await userRow(t.owner.id)).lockedUntil).toBeNull();
  });

  it("lockout is per user: the cashier can still log in while the owner is locked", async () => {
    for (let i = 0; i < 5; i++) {
      await login("owner", "bad", T0).catch(() => undefined);
    }
    await expectAppError(login("owner", "owner-pass-123", T0), "LOCKED");
    const res = await login("cashier", "cashier-pass-123", T0);
    expect(res.ctx).toEqual(t.cashier.ctx);
  });

  it("a deactivated user cannot log in, even with the correct password", async () => {
    await db.update(users).set({ isActive: false }).where(eq(users.id, t.cashier.id));
    const err = await expectAppError(login("cashier", "cashier-pass-123", T0), "UNAUTHENTICATED");
    expect(err.message).toBe("Invalid username or password");
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});

describe("sessions", () => {
  let t: TestShop;

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
  });

  it("validateSession returns the ctx for a live token", async () => {
    const { token } = await login("owner", "owner-pass-123", T0);
    expect(await validateSession(token, hours(T0, 11))).toEqual(t.owner.ctx);
  });

  it("validateSession returns null for a token 13 hours old and deletes the row", async () => {
    const { token } = await login("owner", "owner-pass-123", T0);
    expect(await validateSession(token, hours(T0, 13))).toBeNull();
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("validateSession returns null for unknown or empty tokens", async () => {
    await login("owner", "owner-pass-123", T0);
    expect(await validateSession("not-a-token", T0)).toBeNull();
    expect(await validateSession("", T0)).toBeNull();
  });

  it("validateSession rejects the stored hash used as a token", async () => {
    await login("owner", "owner-pass-123", T0);
    const [row] = await db.select().from(sessions);
    expect(await validateSession(row.tokenHash, T0)).toBeNull();
  });

  it("validateSession returns null after revokeUserSessions, leaving other users alone", async () => {
    const a = await login("owner", "owner-pass-123", T0);
    const b = await login("owner", "owner-pass-123", T0);
    const c = await login("cashier", "cashier-pass-123", T0);
    await revokeUserSessions(t.owner.id);
    expect(await validateSession(a.token, T0)).toBeNull();
    expect(await validateSession(b.token, T0)).toBeNull();
    expect(await validateSession(c.token, T0)).toEqual(t.cashier.ctx);
  });

  it("validateSession returns null once the user is deactivated while holding a live session", async () => {
    const { token } = await login("cashier", "cashier-pass-123", T0);
    expect(await validateSession(token, T0)).toEqual(t.cashier.ctx);
    await db.update(users).set({ isActive: false }).where(eq(users.id, t.cashier.id));
    expect(await validateSession(token, T0)).toBeNull();
  });

  it("logout deletes only that session", async () => {
    const a = await login("owner", "owner-pass-123", T0);
    const b = await login("owner", "owner-pass-123", T0);
    await logout(a.token);
    expect(await validateSession(a.token, T0)).toBeNull();
    expect(await validateSession(b.token, T0)).toEqual(t.owner.ctx);
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, t.owner.id), eq(sessions.tokenHash, hashToken(b.token))));
    expect(rows).toHaveLength(1);
  });
});
