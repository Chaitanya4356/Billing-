import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shopSettings, shops } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { businessDateFor } from "@/lib/time";
import type { AuthContext } from "@/lib/types";
import { recordAudit } from "@/modules/audit/service";
import { assertRole } from "@/modules/auth/guards";
import { syncTokenSequence } from "@/modules/billing/sequences";
import { settingsPatchSchema } from "./schema";
import type { SettingsPatch } from "./schema";

export type ShopSettingsRow = typeof shopSettings.$inferSelect;

export interface ShopInfo {
  name: string;
  address: string;
  phone: string;
  gstin: string | null;
  timezone: string;
}

export interface BillingConfig {
  gstEnabled: boolean;
  gstRateBp: number;
  gstInclusive: boolean;
  roundToRupee: boolean;
  paperWidth: 58 | 80;
  cashierDiscountMaxPctBp: number;
  cashierDiscountMaxFlatPaise: number;
  cashierCanCancel: boolean;
  receiptTitle: string;
}

const SHOP_KEYS = ["name", "address", "phone", "gstin"] as const;
const SETTINGS_KEYS = [
  "receiptHeader",
  "receiptFooter",
  "paperWidth",
  "billPrefix",
  "tokenResetMode",
  "dayStartHour",
  "gstEnabled",
  "gstRateBp",
  "gstInclusive",
  "receiptTitle",
  "roundToRupee",
  "cashierDiscountMaxPctBp",
  "cashierDiscountMaxFlatPaise",
  "cashierCanCancel",
] as const;

/** Billing-relevant settings. Readable by both roles; contains no shop details. */
export async function getBillingConfig(ctx: AuthContext): Promise<BillingConfig> {
  assertRole(ctx, ["OWNER", "CASHIER"]);
  const [row] = await db.select().from(shopSettings).where(eq(shopSettings.shopId, ctx.shopId));
  if (!row) throw new AppError("NOT_FOUND", "Shop settings not found");
  return {
    gstEnabled: row.gstEnabled,
    gstRateBp: row.gstRateBp,
    gstInclusive: row.gstInclusive,
    roundToRupee: row.roundToRupee,
    paperWidth: row.paperWidth === 58 ? 58 : 80,
    cashierDiscountMaxPctBp: row.cashierDiscountMaxPctBp,
    cashierDiscountMaxFlatPaise: row.cashierDiscountMaxFlatPaise,
    cashierCanCancel: row.cashierCanCancel,
    receiptTitle: row.receiptTitle,
  };
}

/** Shop profile and full settings row. OWNER only. */
export async function getSettings(ctx: AuthContext): Promise<{ shop: ShopInfo; settings: ShopSettingsRow }> {
  assertRole(ctx, ["OWNER"]);
  const [shop] = await db
    .select({
      name: shops.name,
      address: shops.address,
      phone: shops.phone,
      gstin: shops.gstin,
      timezone: shops.timezone,
    })
    .from(shops)
    .where(eq(shops.id, ctx.shopId));
  const [settings] = await db.select().from(shopSettings).where(eq(shopSettings.shopId, ctx.shopId));
  if (!shop || !settings) throw new AppError("NOT_FOUND", "Shop not found");
  return { shop, settings };
}

/**
 * Applies a partial patch to the shop profile and settings. OWNER only.
 * One transaction: the row lock, the updates and the audit row commit together.
 * Writes nothing (and no audit row) when no value actually changes.
 * A tokenResetMode change also raises the newly active token counter to the
 * highest token already issued (`now` picks the business date), so the switch
 * can never re-issue a token. Bills lock these rows FOR SHARE while numbering,
 * so the sync serialises with in-flight bills.
 */
export async function updateSettings(
  ctx: AuthContext,
  patch: SettingsPatch,
  now: Date = new Date(),
): Promise<void> {
  assertRole(ctx, ["OWNER"]);
  const parsed = settingsPatchSchema.safeParse(patch);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid settings",
      parsed.error.issues,
    );
  }
  const input = parsed.data;

  await db.transaction(async (tx) => {
    // Lock both rows so concurrent edits are serialised and the diff is exact.
    const [shop] = await tx.select().from(shops).where(eq(shops.id, ctx.shopId)).for("update");
    const [settings] = await tx
      .select()
      .from(shopSettings)
      .where(eq(shopSettings.shopId, ctx.shopId))
      .for("update");
    if (!shop || !settings) throw new AppError("NOT_FOUND", "Shop not found");

    const shopChanges: Partial<typeof shops.$inferInsert> = {};
    const settingsChanges: Record<string, unknown> = {};
    const changed: string[] = [];

    for (const key of SHOP_KEYS) {
      const next = input[key];
      if (next !== undefined && next !== shop[key]) {
        Object.assign(shopChanges, { [key]: next });
        changed.push(key);
      }
    }
    for (const key of SETTINGS_KEYS) {
      const next = input[key];
      if (next !== undefined && next !== settings[key]) {
        settingsChanges[key] = next;
        changed.push(key);
      }
    }

    if (changed.length === 0) return;

    if (Object.keys(shopChanges).length > 0) {
      await tx.update(shops).set(shopChanges).where(eq(shops.id, ctx.shopId));
    }
    if (Object.keys(settingsChanges).length > 0) {
      await tx.update(shopSettings).set(settingsChanges).where(eq(shopSettings.shopId, ctx.shopId));
    }
    if (input.tokenResetMode !== undefined && changed.includes("tokenResetMode")) {
      const dayStartHour = input.dayStartHour ?? settings.dayStartHour;
      const businessDate = businessDateFor(now, shop.timezone, dayStartHour);
      await syncTokenSequence(tx, ctx.shopId, input.tokenResetMode, businessDate);
    }
    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: "SETTINGS_CHANGED",
      entityType: "shop_settings",
      entityId: ctx.shopId,
      meta: { changed },
    });
  });
}
