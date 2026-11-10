import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, shopSettings, shops } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { getBillingConfig, getSettings, updateSettings } from "@/modules/shop/service";
import { makeShop, resetDb, type TestShop } from "../helpers/db";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return "NO_ERROR";
}

async function auditRows(shopId: string) {
  return db.select().from(auditLogs).where(eq(auditLogs.shopId, shopId));
}

describe("shop settings service", () => {
  let t: TestShop;

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
  });

  describe("roles", () => {
    it("cashier updateSettings throws FORBIDDEN and changes nothing", async () => {
      expect(await code(updateSettings(t.cashier.ctx, { gstEnabled: true }))).toBe("FORBIDDEN");
      const [row] = await db.select().from(shopSettings).where(eq(shopSettings.shopId, t.shopId));
      expect(row.gstEnabled).toBe(false);
      expect(await auditRows(t.shopId)).toHaveLength(0);
    });

    it("cashier getSettings throws FORBIDDEN", async () => {
      expect(await code(getSettings(t.cashier.ctx))).toBe("FORBIDDEN");
    });

    it("cashier can read the billing config; it has exactly the billing fields", async () => {
      const cfg = await getBillingConfig(t.cashier.ctx);
      expect(cfg).toEqual({
        gstEnabled: false,
        gstRateBp: 500,
        gstInclusive: true,
        roundToRupee: false,
        paperWidth: 80,
        cashierDiscountMaxPctBp: 0,
        cashierDiscountMaxFlatPaise: 0,
        cashierCanCancel: false,
        receiptTitle: "Tax Invoice",
      });
    });

    it("owner getBillingConfig reflects settings", async () => {
      await updateSettings(t.owner.ctx, { gstEnabled: true, gstRateBp: 1800, paperWidth: 58 });
      const cfg = await getBillingConfig(t.owner.ctx);
      expect(cfg).toMatchObject({ gstEnabled: true, gstRateBp: 1800, paperWidth: 58 });
    });

    it("owner getSettings returns shop info and the full settings row", async () => {
      const { shop, settings } = await getSettings(t.owner.ctx);
      expect(shop).toMatchObject({ name: "Test Shop", address: "", phone: "", gstin: null, timezone: "Asia/Kolkata" });
      expect(settings).toMatchObject({
        shopId: t.shopId,
        receiptHeader: "",
        receiptFooter: "Thank you! Visit again",
        paperWidth: 80,
        billPrefix: "B",
        tokenResetMode: "DAILY",
        dayStartHour: 0,
      });
    });
  });

  describe("validation", () => {
    const invalid: Array<[string, Record<string, unknown>]> = [
      ["paperWidth 57", { paperWidth: 57 }],
      ["paperWidth string", { paperWidth: "80" }],
      ["gstRateBp -1", { gstRateBp: -1 }],
      ["gstRateBp 10001", { gstRateBp: 10001 }],
      ["gstRateBp fractional", { gstRateBp: 5.5 }],
      ["dayStartHour -1", { dayStartHour: -1 }],
      ["dayStartHour 24", { dayStartHour: 24 }],
      ["billPrefix empty", { billPrefix: "" }],
      ["billPrefix too long", { billPrefix: "ABCDEFG" }],
      ["billPrefix lowercase", { billPrefix: "ab" }],
      ["billPrefix symbol", { billPrefix: "A-1" }],
      ["gstin too short", { gstin: "27AAPFU0939F1Z" }],
      ["gstin lowercase", { gstin: "27aapfu0939f1zv" }],
      ["gstin bad shape", { gstin: "ABAAPFU0939F1ZV" }],
      ["shop name empty", { name: "" }],
      ["shop name blank", { name: "   " }],
      ["shop name 81 chars", { name: "x".repeat(81) }],
      ["receiptHeader 201 chars", { receiptHeader: "x".repeat(201) }],
      ["receiptFooter 201 chars", { receiptFooter: "x".repeat(201) }],
      ["tokenResetMode bad", { tokenResetMode: "WEEKLY" }],
      ["negative flat limit", { cashierDiscountMaxFlatPaise: -1 }],
      ["pct limit over 100%", { cashierDiscountMaxPctBp: 10001 }],
      ["unknown key shopId", { shopId: "x" }],
      ["unknown key timezone", { timezone: "UTC" }],
    ];

    it.each(invalid)("rejects %s with VALIDATION", async (_label, patch) => {
      expect(await code(updateSettings(t.owner.ctx, patch as never))).toBe("VALIDATION");
      expect(await auditRows(t.shopId)).toHaveLength(0);
    });

    it("accepts boundary values", async () => {
      await updateSettings(t.owner.ctx, {
        paperWidth: 58,
        gstRateBp: 0,
        dayStartHour: 23,
        billPrefix: "ABC123",
        gstin: "27AAPFU0939F1ZV",
        name: "x".repeat(80),
        receiptHeader: "y".repeat(200),
        receiptFooter: "",
        cashierDiscountMaxPctBp: 10000,
        cashierDiscountMaxFlatPaise: 0,
      });
      const { shop, settings } = await getSettings(t.owner.ctx);
      expect(shop.gstin).toBe("27AAPFU0939F1ZV");
      expect(settings).toMatchObject({ paperWidth: 58, gstRateBp: 0, dayStartHour: 23, billPrefix: "ABC123" });
    });

    it("blank or null gstin clears it", async () => {
      await updateSettings(t.owner.ctx, { gstin: "27AAPFU0939F1ZV" });
      await updateSettings(t.owner.ctx, { gstin: "" });
      expect((await getSettings(t.owner.ctx)).shop.gstin).toBeNull();
      await updateSettings(t.owner.ctx, { gstin: "27AAPFU0939F1ZV" });
      await updateSettings(t.owner.ctx, { gstin: null });
      expect((await getSettings(t.owner.ctx)).shop.gstin).toBeNull();
    });

    it("rejects a patch atomically: nothing from a mixed invalid patch is applied", async () => {
      expect(await code(updateSettings(t.owner.ctx, { name: "New Name", paperWidth: 57 } as never))).toBe(
        "VALIDATION",
      );
      expect((await getSettings(t.owner.ctx)).shop.name).toBe("Test Shop");
    });
  });

  describe("update and audit", () => {
    it("persists across shops and settings tables and writes one SETTINGS_CHANGED audit row", async () => {
      await updateSettings(t.owner.ctx, {
        name: "Chai Point",
        gstRateBp: 1200,
        receiptFooter: "Come again",
      });
      const { shop, settings } = await getSettings(t.owner.ctx);
      expect(shop.name).toBe("Chai Point");
      expect(settings.gstRateBp).toBe(1200);
      expect(settings.receiptFooter).toBe("Come again");

      const rows = await auditRows(t.shopId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        shopId: t.shopId,
        userId: t.owner.id,
        action: "SETTINGS_CHANGED",
      });
      const changed = (rows[0].meta as { changed: string[] }).changed;
      expect([...changed].sort()).toEqual(["gstRateBp", "name", "receiptFooter"]);
    });

    it("meta.changed lists only keys whose value actually changed", async () => {
      await updateSettings(t.owner.ctx, { name: "Test Shop", billPrefix: "X", gstEnabled: false, dayStartHour: 4 });
      const rows = await auditRows(t.shopId);
      expect(rows).toHaveLength(1);
      expect([...(rows[0].meta as { changed: string[] }).changed].sort()).toEqual(["billPrefix", "dayStartHour"]);
    });

    it("an update that changes nothing writes no audit row", async () => {
      await updateSettings(t.owner.ctx, { name: "Test Shop", paperWidth: 80, gstin: null });
      await updateSettings(t.owner.ctx, {});
      expect(await auditRows(t.shopId)).toHaveLength(0);
    });

    it("trims text fields before comparing and storing", async () => {
      await updateSettings(t.owner.ctx, { name: "  Test Shop  " });
      expect(await auditRows(t.shopId)).toHaveLength(0);
      await updateSettings(t.owner.ctx, { name: "  Spaced  " });
      expect((await getSettings(t.owner.ctx)).shop.name).toBe("Spaced");
    });

    it("a zero discount limit is settable", async () => {
      await updateSettings(t.owner.ctx, { cashierDiscountMaxPctBp: 500, cashierDiscountMaxFlatPaise: 5000 });
      await updateSettings(t.owner.ctx, { cashierDiscountMaxPctBp: 0, cashierDiscountMaxFlatPaise: 0 });
      expect(await getBillingConfig(t.cashier.ctx)).toMatchObject({
        cashierDiscountMaxPctBp: 0,
        cashierDiscountMaxFlatPaise: 0,
      });
    });

    it("does not touch other shops", async () => {
      const other = await makeShop();
      const [before] = await db.select().from(shopSettings).where(eq(shopSettings.shopId, other.shopId));
      await updateSettings(t.owner.ctx, { name: "Mine", gstEnabled: true, gstRateBp: 100, billPrefix: "Z" });
      const [after] = await db.select().from(shopSettings).where(eq(shopSettings.shopId, other.shopId));
      const [otherShop] = await db.select().from(shops).where(eq(shops.id, other.shopId));
      expect(after).toEqual(before);
      expect(otherShop.name).toBe("Test Shop");
      expect(await auditRows(other.shopId)).toHaveLength(0);
    });

    it("an owner of another shop cannot affect this shop", async () => {
      const other = await makeShop();
      await updateSettings(other.owner.ctx, { name: "Theirs" });
      expect((await getSettings(t.owner.ctx)).shop.name).toBe("Test Shop");
    });
  });
});
