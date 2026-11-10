import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shopSettings } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/types";
import { getBill, recordPrint } from "@/modules/bills/service";
import { getBillingConfig } from "@/modules/shop/service";
import { buildReceiptData } from "./receipt";
import { renderReceiptHtml } from "./render-html";

/**
 * Records the print (first = original, later = REPRINT) and returns the
 * receipt HTML for the stored bill. The print is counted before rendering, so
 * a bill the caller cannot read records nothing. The receipt body comes from
 * the bill's own snapshots; only header/footer text and paper width come from
 * the current settings.
 */
export async function prepareReceiptPrint(
  ctx: AuthContext,
  billId: string,
  now: Date = new Date(),
): Promise<{ html: string; isReprint: boolean }> {
  const { isReprint } = await recordPrint(ctx, billId, now);
  const bill = await getBill(ctx, billId, now);
  const [text] = await db
    .select({ header: shopSettings.receiptHeader, footer: shopSettings.receiptFooter })
    .from(shopSettings)
    .where(eq(shopSettings.shopId, ctx.shopId));
  if (!text) throw new AppError("NOT_FOUND", "Shop settings not found");
  const { paperWidth } = await getBillingConfig(ctx);

  const data = buildReceiptData(bill, text, { isReprint });
  return { html: renderReceiptHtml(data, paperWidth), isReprint };
}
