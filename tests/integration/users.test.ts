import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, sessions, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { MAX_FAILED_ATTEMPTS, login } from "@/modules/auth/service";
import { validateSession } from "@/modules/auth/session";
import {
  changeOwnPassword,
  createCashier,
  listUsers,
  resetPassword,
  setUserActive,
} from "@/modules/users/service";
import { makeShop, resetDb, type TestShop } from "../helpers/db";

const T0 = new Date("2026-11-10T09:00:00.000Z");

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

async function loginOutcome(username: string, password: string): Promise<string> {
  return login(username, password).then(
    () => "ok",
    (e: AppError) => e.code,
  );
}

const NEW_PW = "fresh-pass-456";

describe("user management", () => {
  let t: TestShop;

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
  });

  describe("role checks", () => {
    it("a cashier gets FORBIDDEN from every function, before any validation", async () => {
      const c = t.cashier.ctx;
      await expectAppError(listUsers(c), "FORBIDDEN");
      await expectAppError(createCashier(c, { name: "", username: "!", password: "x" }), "FORBIDDEN");
      await expectAppError(createCashier(c, { name: "Ann", username: "ann", password: NEW_PW }), "FORBIDDEN");
      await expectAppError(resetPassword(c, "not-a-uuid", "x"), "FORBIDDEN");
      await expectAppError(resetPassword(c, t.cashier.id, NEW_PW), "FORBIDDEN");
      await expectAppError(setUserActive(c, t.cashier.id, false), "FORBIDDEN");
      await expectAppError(changeOwnPassword(c, t.cashier.password, NEW_PW), "FORBIDDEN");
      // Nothing changed.
      expect((await userRow(t.cashier.id)).isActive).toBe(true);
      expect(await loginOutcome("cashier", t.cashier.password)).toBe("ok");
      expect(await db.select().from(auditLogs).where(sql`${auditLogs.action} LIKE 'USER_%'`)).toHaveLength(0);
    });
  });

  describe("listUsers", () => {
    it("lists the shop's users (owner first) without password hashes", async () => {
      const other = await makeShop();
      const rows = await listUsers(t.owner.ctx);
      expect(rows.map((r) => r.username)).toEqual(["owner", "cashier"]);
      expect(rows.map((r) => r.id)).not.toContain(other.owner.id);
      expect(rows[0]).toEqual({
        id: t.owner.id,
        name: "Test Owner",
        username: "owner",
        role: "OWNER",
        isActive: true,
        createdAt: expect.any(Date),
      });
      expect(JSON.stringify(rows)).not.toContain("argon2");
    });
  });

  describe("createCashier", () => {
    it("creates an active cashier, audits USER_CREATED and the cashier can log in", async () => {
      const row = await createCashier(t.owner.ctx, { name: "  Asha  ", username: "Asha.K", password: NEW_PW });
      expect(row).toEqual({
        id: expect.any(String),
        name: "Asha",
        username: "asha.k",
        role: "CASHIER",
        isActive: true,
        createdAt: expect.any(Date),
      });
      expect(Object.keys(row)).not.toContain("passwordHash");

      const audits = await auditRows("USER_CREATED");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        shopId: t.shopId,
        userId: t.owner.id,
        entityType: "user",
        entityId: row.id,
        meta: { username: "asha.k" },
      });

      const res = await login("asha.k", NEW_PW, T0);
      expect(res.ctx).toEqual({ shopId: t.shopId, userId: row.id, role: "CASHIER" });
    });

    it("a duplicate username (any case) is CONFLICT", async () => {
      await createCashier(t.owner.ctx, { name: "Asha", username: "asha", password: NEW_PW });
      await expectAppError(createCashier(t.owner.ctx, { name: "Asha 2", username: "asha", password: NEW_PW }), "CONFLICT");
      await expectAppError(createCashier(t.owner.ctx, { name: "Asha 3", username: "ASHA", password: NEW_PW }), "CONFLICT");
      await expectAppError(createCashier(t.owner.ctx, { name: "Clash", username: "owner", password: NEW_PW }), "CONFLICT");
      expect(await auditRows("USER_CREATED")).toHaveLength(1);
    });

    it("the same username in another shop is fine", async () => {
      const other = await makeShop();
      const row = await createCashier(other.owner.ctx, { name: "Asha", username: "cashier2", password: NEW_PW });
      await createCashier(t.owner.ctx, { name: "Asha", username: "cashier2", password: NEW_PW });
      expect(row.username).toBe("cashier2");
    });

    it.each([
      ["short password", { name: "Asha", username: "asha", password: "1234567" }],
      ["long password", { name: "Asha", username: "asha", password: "x".repeat(129) }],
      ["bad username chars", { name: "Asha", username: "asha k", password: NEW_PW }],
      ["bad username symbol", { name: "Asha", username: "asha@shop", password: NEW_PW }],
      ["short username", { name: "Asha", username: "as", password: NEW_PW }],
      ["long username", { name: "Asha", username: "a".repeat(33), password: NEW_PW }],
      ["empty name", { name: "   ", username: "asha", password: NEW_PW }],
      ["long name", { name: "n".repeat(61), username: "asha", password: NEW_PW }],
    ])("%s is VALIDATION", async (_label, input) => {
      await expectAppError(createCashier(t.owner.ctx, input), "VALIDATION");
      expect(await db.select().from(users).where(eq(users.username, input.username.toLowerCase()))).toHaveLength(0);
    });

    it("accepts the boundary lengths", async () => {
      await createCashier(t.owner.ctx, { name: "n".repeat(60), username: "a._-9".padEnd(32, "z"), password: "x".repeat(128) });
      await createCashier(t.owner.ctx, { name: "N", username: "abc", password: "12345678" });
      expect(await auditRows("USER_CREATED")).toHaveLength(2);
    });

    it("rejects unknown keys", async () => {
      await expectAppError(
        createCashier(t.owner.ctx, { name: "Asha", username: "asha", password: NEW_PW, role: "OWNER" } as never),
        "VALIDATION",
      );
    });
  });

  describe("resetPassword", () => {
    it("new password works, old does not, audited, earlier session revoked", async () => {
      const before = await login("cashier", t.cashier.password);
      expect(await validateSession(before.token)).toEqual(t.cashier.ctx);

      await resetPassword(t.owner.ctx, t.cashier.id, NEW_PW);

      expect(await validateSession(before.token)).toBeNull();
      expect(await db.select().from(sessions).where(eq(sessions.userId, t.cashier.id))).toHaveLength(0);
      expect(await loginOutcome("cashier", t.cashier.password)).toBe("UNAUTHENTICATED");
      expect(await loginOutcome("cashier", NEW_PW)).toBe("ok");

      const audits = await auditRows("USER_PASSWORD_RESET");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        shopId: t.shopId,
        userId: t.owner.id,
        entityType: "user",
        entityId: t.cashier.id,
        meta: {},
      });
    });

    it("clears a lockout", async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await loginOutcome("cashier", "wrong-password");
      expect(await loginOutcome("cashier", t.cashier.password)).toBe("LOCKED");
      expect((await userRow(t.cashier.id)).lockedUntil).not.toBeNull();

      await resetPassword(t.owner.ctx, t.cashier.id, NEW_PW);

      const row = await userRow(t.cashier.id);
      expect(row.lockedUntil).toBeNull();
      expect(row.failedAttempts).toBe(0);
      expect(await loginOutcome("cashier", NEW_PW)).toBe("ok");
    });

    it("leaves other users' sessions alone", async () => {
      const owner = await login("owner", t.owner.password);
      await resetPassword(t.owner.ctx, t.cashier.id, NEW_PW);
      expect(await validateSession(owner.token)).toEqual(t.owner.ctx);
    });

    it("rejects a short or long new password", async () => {
      await expectAppError(resetPassword(t.owner.ctx, t.cashier.id, "short"), "VALIDATION");
      await expectAppError(resetPassword(t.owner.ctx, t.cashier.id, "x".repeat(129)), "VALIDATION");
      expect(await loginOutcome("cashier", t.cashier.password)).toBe("ok");
    });

    it("targeting an owner (including self) is FORBIDDEN", async () => {
      await expectAppError(resetPassword(t.owner.ctx, t.owner.id, NEW_PW), "FORBIDDEN");
      expect(await loginOutcome("owner", t.owner.password)).toBe("ok");
      expect(await auditRows("USER_PASSWORD_RESET")).toHaveLength(0);
    });

    it("another shop's user or a malformed id is NOT_FOUND", async () => {
      const other = await makeShop();
      await expectAppError(resetPassword(t.owner.ctx, other.cashier.id, NEW_PW), "NOT_FOUND");
      await expectAppError(resetPassword(t.owner.ctx, other.owner.id, NEW_PW), "NOT_FOUND");
      await expectAppError(resetPassword(t.owner.ctx, "not-a-uuid", NEW_PW), "NOT_FOUND");
      await expectAppError(resetPassword(t.owner.ctx, "00000000-0000-0000-0000-000000000000", NEW_PW), "NOT_FOUND");
      expect(await auditRows("USER_PASSWORD_RESET")).toHaveLength(0);
    });
  });

  describe("setUserActive", () => {
    it("deactivation blocks login, kills a live session and audits USER_DEACTIVATED", async () => {
      const live = await login("cashier", t.cashier.password);
      await setUserActive(t.owner.ctx, t.cashier.id, false);

      expect(await validateSession(live.token)).toBeNull();
      expect(await db.select().from(sessions).where(eq(sessions.userId, t.cashier.id))).toHaveLength(0);
      expect(await loginOutcome("cashier", t.cashier.password)).toBe("UNAUTHENTICATED");
      expect((await userRow(t.cashier.id)).isActive).toBe(false);

      const audits = await auditRows("USER_DEACTIVATED");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ userId: t.owner.id, entityType: "user", entityId: t.cashier.id, meta: {} });
    });

    it("reactivation restores login, keeps the password, clears lockout and audits USER_REACTIVATED", async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await loginOutcome("cashier", "wrong-password");
      const hashBefore = (await userRow(t.cashier.id)).passwordHash;
      await setUserActive(t.owner.ctx, t.cashier.id, false);
      await setUserActive(t.owner.ctx, t.cashier.id, true);

      const row = await userRow(t.cashier.id);
      expect(row.isActive).toBe(true);
      expect(row.passwordHash).toBe(hashBefore);
      expect(row.lockedUntil).toBeNull();
      expect(row.failedAttempts).toBe(0);
      expect(await loginOutcome("cashier", t.cashier.password)).toBe("ok");

      const audits = await auditRows("USER_REACTIVATED");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ userId: t.owner.id, entityId: t.cashier.id, meta: {} });
    });

    it("targeting an owner (including self) is FORBIDDEN", async () => {
      await expectAppError(setUserActive(t.owner.ctx, t.owner.id, false), "FORBIDDEN");
      expect((await userRow(t.owner.id)).isActive).toBe(true);
      expect(await auditRows("USER_DEACTIVATED")).toHaveLength(0);
    });

    it("another shop's user or a malformed id is NOT_FOUND", async () => {
      const other = await makeShop();
      await expectAppError(setUserActive(t.owner.ctx, other.cashier.id, false), "NOT_FOUND");
      await expectAppError(setUserActive(t.owner.ctx, "nope", false), "NOT_FOUND");
      expect((await userRow(other.cashier.id)).isActive).toBe(true);
    });

    it("a non-boolean flag is VALIDATION", async () => {
      await expectAppError(setUserActive(t.owner.ctx, t.cashier.id, "false" as never), "VALIDATION");
      expect((await userRow(t.cashier.id)).isActive).toBe(true);
    });
  });

  describe("changeOwnPassword", () => {
    it("a wrong current password is UNAUTHENTICATED and changes nothing (no lockout counting)", async () => {
      const live = await login("owner", t.owner.password);
      await expectAppError(changeOwnPassword(t.owner.ctx, "not-my-password", NEW_PW), "UNAUTHENTICATED");
      expect(await validateSession(live.token)).toEqual(t.owner.ctx);
      expect((await userRow(t.owner.id)).failedAttempts).toBe(0);
      expect(await loginOutcome("owner", t.owner.password)).toBe("ok");
      expect(await auditRows("USER_PASSWORD_RESET")).toHaveLength(0);
    });

    it("the right current password changes it, revokes every session and audits { self: true }", async () => {
      const a = await login("owner", t.owner.password);
      const b = await login("owner", t.owner.password);
      const cashier = await login("cashier", t.cashier.password);

      await changeOwnPassword(t.owner.ctx, t.owner.password, NEW_PW);

      expect(await validateSession(a.token)).toBeNull();
      expect(await validateSession(b.token)).toBeNull();
      expect(await validateSession(cashier.token)).toEqual(t.cashier.ctx);
      expect(await loginOutcome("owner", t.owner.password)).toBe("UNAUTHENTICATED");
      expect(await loginOutcome("owner", NEW_PW)).toBe("ok");

      const audits = await auditRows("USER_PASSWORD_RESET");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ userId: t.owner.id, entityId: t.owner.id, meta: { self: true } });
    });

    it("the same password again is allowed and stores a new hash", async () => {
      const before = (await userRow(t.owner.id)).passwordHash;
      await changeOwnPassword(t.owner.ctx, t.owner.password, t.owner.password);
      expect((await userRow(t.owner.id)).passwordHash).not.toBe(before);
      expect(await loginOutcome("owner", t.owner.password)).toBe("ok");
    });

    it("a short new password is VALIDATION", async () => {
      await expectAppError(changeOwnPassword(t.owner.ctx, t.owner.password, "short"), "VALIDATION");
      expect(await loginOutcome("owner", t.owner.password)).toBe("ok");
    });
  });

  it("passwords and hashes never appear in audit meta", async () => {
    const created = await createCashier(t.owner.ctx, { name: "Asha", username: "asha", password: "created-pass-1" });
    await resetPassword(t.owner.ctx, created.id, "reset-pass-22");
    await setUserActive(t.owner.ctx, created.id, false);
    await setUserActive(t.owner.ctx, created.id, true);
    await changeOwnPassword(t.owner.ctx, t.owner.password, "changed-pass-333");

    const rows = await db.select().from(auditLogs);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const allUsers = await db.select({ h: users.passwordHash }).from(users);
    const text = JSON.stringify(rows.map((r) => r.meta));
    for (const secret of ["created-pass-1", "reset-pass-22", "changed-pass-333", t.owner.password, "argon2"]) {
      expect(text).not.toContain(secret);
    }
    for (const { h } of allUsers) expect(text).not.toContain(h);
  });
});
