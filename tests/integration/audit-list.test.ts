import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditLogs, shops } from "@/db/schema";
import { AUDIT_ACTIONS, listAudit, type AuditAction } from "@/modules/audit/service";
import { makeShop, resetDb, type TestShop } from "../helpers/db";

async function insert(
  shopId: string,
  o: {
    at: string;
    action?: AuditAction;
    userId?: string | null;
    entityType?: string;
    entityId?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<string> {
  const [row] = await db
    .insert(auditLogs)
    .values({
      shopId,
      userId: o.userId ?? null,
      action: o.action ?? "SETTINGS_CHANGED",
      entityType: o.entityType ?? "shop",
      entityId: o.entityId ?? null,
      meta: o.meta ?? {},
      createdAt: new Date(o.at),
    })
    .returning({ id: auditLogs.id });
  return row.id;
}

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code);

describe("listAudit", () => {
  let t: TestShop;

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
  });

  it("exports every action as a runtime list", () => {
    expect(AUDIT_ACTIONS).toHaveLength(16);
    expect(new Set(AUDIT_ACTIONS).size).toBe(16);
  });

  it("is OWNER only, and the role check comes before validation", async () => {
    expect(await code(listAudit(t.cashier.ctx, {}))).toBe("FORBIDDEN");
    expect(await code(listAudit(t.cashier.ctx, { from: "garbage", page: 0 }))).toBe("FORBIDDEN");
    expect(await code(listAudit(t.cashier.ctx, { bogus: 1 } as never))).toBe("FORBIDDEN");
    expect(await code(listAudit(t.owner.ctx, {}))).toBe("ok");
  });

  it("returns an empty page for a shop without audit rows", async () => {
    expect(await listAudit(t.owner.ctx, {})).toEqual({ rows: [], total: 0 });
  });

  it("lists newest first", async () => {
    const a = await insert(t.shopId, { at: "2026-11-01T10:00:00Z" });
    const b = await insert(t.shopId, { at: "2026-11-03T10:00:00Z" });
    const c = await insert(t.shopId, { at: "2026-11-02T10:00:00Z" });
    const { rows, total } = await listAudit(t.owner.ctx, {});
    expect(total).toBe(3);
    expect(rows.map((r) => r.id)).toEqual([b, c, a]);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0].createdAt.toISOString()).toBe("2026-11-03T10:00:00.000Z");
  });

  it("orders rows with identical timestamps consistently across pages", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add(await insert(t.shopId, { at: "2026-11-01T10:00:00Z" }));
    const p1 = await listAudit(t.owner.ctx, { pageSize: 2, page: 1 });
    const p2 = await listAudit(t.owner.ctx, { pageSize: 2, page: 2 });
    const p3 = await listAudit(t.owner.ctx, { pageSize: 2, page: 3 });
    const seen = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id);
    expect(new Set(seen)).toEqual(ids);
    expect(seen).toHaveLength(5);
  });

  it("filters by action", async () => {
    await insert(t.shopId, { at: "2026-11-01T10:00:00Z", action: "BILL_CREATED" });
    const c1 = await insert(t.shopId, { at: "2026-11-02T10:00:00Z", action: "BILL_CANCELLED" });
    await insert(t.shopId, { at: "2026-11-03T10:00:00Z", action: "SETTINGS_CHANGED" });
    const { rows, total } = await listAudit(t.owner.ctx, { action: "BILL_CANCELLED" });
    expect(total).toBe(1);
    expect(rows.map((r) => r.id)).toEqual([c1]);
    expect(rows[0].action).toBe("BILL_CANCELLED");
  });

  it("filters by the shop's calendar dates (IST), inclusive on both ends", async () => {
    // 2026-11-09T18:45:00Z is 00:15 IST on 2026-11-10.
    const lateUtc = await insert(t.shopId, { at: "2026-11-09T18:45:00Z" });
    const ids = async (q: { from?: string; to?: string }) => (await listAudit(t.owner.ctx, q)).rows.map((r) => r.id);

    expect(await ids({ from: "2026-11-10", to: "2026-11-10" })).toEqual([lateUtc]);
    expect(await ids({ from: "2026-11-09", to: "2026-11-09" })).toEqual([]);
    expect(await ids({ from: "2026-11-09", to: "2026-11-10" })).toEqual([lateUtc]);
    expect(await ids({ from: "2026-11-10" })).toEqual([lateUtc]);
    expect(await ids({ to: "2026-11-09" })).toEqual([]);
  });

  it("splits days exactly at IST midnight (18:30:00Z)", async () => {
    const before = await insert(t.shopId, { at: "2026-11-09T18:29:59Z" });
    const at = await insert(t.shopId, { at: "2026-11-09T18:30:00Z" });
    const ids = async (d: string) => (await listAudit(t.owner.ctx, { from: d, to: d })).rows.map((r) => r.id);
    expect(await ids("2026-11-09")).toEqual([before]);
    expect(await ids("2026-11-10")).toEqual([at]);
  });

  it("combines date range, action and total", async () => {
    await insert(t.shopId, { at: "2026-11-05T06:00:00Z", action: "BILL_CREATED" });
    const hit = await insert(t.shopId, { at: "2026-11-06T06:00:00Z", action: "BILL_CREATED" });
    await insert(t.shopId, { at: "2026-11-06T06:00:00Z", action: "BILL_PRINTED" });
    await insert(t.shopId, { at: "2026-11-08T06:00:00Z", action: "BILL_CREATED" });
    const { rows, total } = await listAudit(t.owner.ctx, {
      from: "2026-11-06",
      to: "2026-11-07",
      action: "BILL_CREATED",
    });
    expect(total).toBe(1);
    expect(rows.map((r) => r.id)).toEqual([hit]);
  });

  it("uses the shop's own timezone for dates", async () => {
    await db.update(shops).set({ timezone: "America/New_York" }).where(eq(shops.id, t.shopId));
    // 2026-11-10T03:00:00Z is 22:00 on 2026-11-09 in New York (EST, UTC-5).
    const id = await insert(t.shopId, { at: "2026-11-10T03:00:00Z" });
    const day = async (d: string) => (await listAudit(t.owner.ctx, { from: d, to: d })).rows.map((r) => r.id);
    expect(await day("2026-11-09")).toEqual([id]);
    expect(await day("2026-11-10")).toEqual([]);
  });

  it("joins the user's name, and gives null for rows without a user", async () => {
    await insert(t.shopId, { at: "2026-11-01T10:00:00Z", userId: t.owner.id });
    await insert(t.shopId, {
      at: "2026-11-02T10:00:00Z",
      action: "LOGIN_FAILED",
      userId: null,
      entityType: "user",
      meta: { username: "nobody" },
    });
    const { rows } = await listAudit(t.owner.ctx, {});
    expect(rows[0].userName).toBeNull();
    expect(rows[1].userName).toBe("Test Owner");
  });

  it("never shows another shop's rows, in either direction", async () => {
    const other = await makeShop();
    const mine = await insert(t.shopId, { at: "2026-11-01T10:00:00Z", userId: t.owner.id });
    const theirs = await insert(other.shopId, { at: "2026-11-02T10:00:00Z", userId: other.owner.id });

    const a = await listAudit(t.owner.ctx, {});
    expect(a.total).toBe(1);
    expect(a.rows.map((r) => r.id)).toEqual([mine]);
    const b = await listAudit(other.owner.ctx, {});
    expect(b.total).toBe(1);
    expect(b.rows.map((r) => r.id)).toEqual([theirs]);
  });

  it("does not resolve a user name from another shop (the users join is shop-scoped)", async () => {
    const other = await makeShop();
    // A row of this shop that points at the other shop's user: the name must not resolve.
    await insert(t.shopId, { at: "2026-11-01T10:00:00Z", userId: other.owner.id });
    const { rows } = await listAudit(t.owner.ctx, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].userName).toBeNull();
  });

  it("paginates with a stable total: 7 rows, pageSize 3 gives 3, 3, 1", async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 7; i++) ids.push(await insert(t.shopId, { at: `2026-11-0${i}T10:00:00Z` }));
    const newestFirst = [...ids].reverse();
    const p1 = await listAudit(t.owner.ctx, { pageSize: 3, page: 1 });
    const p2 = await listAudit(t.owner.ctx, { pageSize: 3, page: 2 });
    const p3 = await listAudit(t.owner.ctx, { pageSize: 3, page: 3 });
    const p4 = await listAudit(t.owner.ctx, { pageSize: 3, page: 4 });
    expect([p1.rows.length, p2.rows.length, p3.rows.length, p4.rows.length]).toEqual([3, 3, 1, 0]);
    expect([p1.total, p2.total, p3.total, p4.total]).toEqual([7, 7, 7, 7]);
    expect([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id)).toEqual(newestFirst);
  });

  it("defaults to page 1 and a page size of 50", async () => {
    for (let i = 0; i < 52; i++) {
      await insert(t.shopId, { at: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString() });
    }
    const { rows, total } = await listAudit(t.owner.ctx, {});
    expect(rows).toHaveLength(50);
    expect(total).toBe(52);
  });

  it("round-trips entity fields and meta", async () => {
    const meta = { from: 1000, to: 1200, nested: { tags: ["a", "b"], ok: true }, note: null };
    const id = await insert(t.shopId, {
      at: "2026-11-01T10:00:00Z",
      action: "PRODUCT_PRICE_CHANGED",
      entityType: "product",
      entityId: "abc-123",
      meta,
    });
    const { rows } = await listAudit(t.owner.ctx, {});
    expect(rows[0]).toMatchObject({
      id,
      action: "PRODUCT_PRICE_CHANGED",
      entityType: "product",
      entityId: "abc-123",
      meta,
    });
  });

  it("rejects invalid input with VALIDATION", async () => {
    const bad: unknown[] = [
      { from: "2026-13-01" },
      { from: "2026-02-30" },
      { to: "10-11-2026" },
      { from: "garbage" },
      { from: "2026-11-11", to: "2026-11-10" },
      { action: "NOT_AN_ACTION" },
      { page: 0 },
      { page: 1.5 },
      { pageSize: 0 },
      { pageSize: 101 },
      { pageSize: "10" },
      { unknown: 1 },
    ];
    for (const q of bad) {
      expect(await code(listAudit(t.owner.ctx, q as never)), JSON.stringify(q)).toBe("VALIDATION");
    }
  });

  it("accepts every known action as a filter, and from equal to to", async () => {
    for (const action of AUDIT_ACTIONS) {
      expect(await code(listAudit(t.owner.ctx, { action }))).toBe("ok");
    }
    expect(await code(listAudit(t.owner.ctx, { from: "2026-11-10", to: "2026-11-10" }))).toBe("ok");
  });
});
