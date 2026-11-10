import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { recordAudit } from "@/modules/audit/service";
import { makeShop, resetDb, type TestShop } from "../helpers/db";

describe("recordAudit", () => {
  let t: TestShop;

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
  });

  it("inserts one row with the given fields and round-trips meta", async () => {
    const meta = { from: 1000, to: 1200, nested: { tags: ["a", "b"], ok: true } };
    await recordAudit(db, {
      shopId: t.shopId,
      userId: t.owner.id,
      action: "PRODUCT_PRICE_CHANGED",
      entityType: "product",
      entityId: "abc-123",
      meta,
    });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.shopId, t.shopId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shopId: t.shopId,
      userId: t.owner.id,
      action: "PRODUCT_PRICE_CHANGED",
      entityType: "product",
      entityId: "abc-123",
      meta,
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("allows null userId/entityId and defaults meta to {}", async () => {
    await recordAudit(db, {
      shopId: t.shopId,
      userId: null,
      action: "LOGIN_FAILED",
      entityType: "user",
      entityId: null,
    });

    const rows = await db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].entityId).toBeNull();
    expect(rows[0].meta).toEqual({});
  });

  it("leaves no row when the surrounding transaction is rolled back", async () => {
    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, {
          shopId: t.shopId,
          userId: t.owner.id,
          action: "BILL_CANCELLED",
          entityType: "bill",
          entityId: "bill-1",
          meta: { reason: "test" },
        });
        const inside = await tx.select().from(auditLogs);
        expect(inside).toHaveLength(1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    const rows = await db.select().from(auditLogs);
    expect(rows).toHaveLength(0);
  });

  it("persists the row when the surrounding transaction commits", async () => {
    await db.transaction(async (tx) => {
      await recordAudit(tx, {
        shopId: t.shopId,
        userId: t.cashier.id,
        action: "BILL_CREATED",
        entityType: "bill",
        entityId: "bill-2",
      });
    });
    const rows = await db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("BILL_CREATED");
  });
});
