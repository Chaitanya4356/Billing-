import { describe, expect, it } from "vitest";
import { calculateTotals } from "@/modules/billing/calc";
import { renderReceiptHtml } from "@/modules/printing/render-html";
import { sampleReceiptData } from "@/modules/printing/sample";

const shop = { name: "Chai Point", address: "12 MG Road\nPune", phone: "9876543210", gstin: null };
const text = { header: "Welcome!", footer: "Thank you, visit again" };

function recompute(data: ReturnType<typeof sampleReceiptData>, gst: { enabled: boolean; rateBp: number; inclusive: boolean }) {
  return calculateTotals({
    lines: data.items.map((i) => ({ unitPricePaise: i.unitPricePaise, quantity: i.quantity })),
    discount: data.discountPaise > 0 ? { type: "FLAT", value: data.discountPaise } : null,
    gst,
    roundToRupee: false,
  });
}

describe("sampleReceiptData", () => {
  it("is flagged as a sample and not a reprint", () => {
    const data = sampleReceiptData(shop, text);
    expect(data.isSample).toBe(true);
    expect(data.isReprint).toBe(false);
    expect(data.status).toBe("COMPLETED");
  });

  it("has consistent totals", () => {
    for (const settings of [
      undefined,
      { receiptTitle: "Tax Invoice", gstEnabled: true, gstRateBp: 1800, gstInclusive: false },
      { receiptTitle: "Tax Invoice", gstEnabled: true, gstRateBp: 500, gstInclusive: true },
    ]) {
      const data = sampleReceiptData(shop, text, settings);
      expect(data.items.length).toBeGreaterThanOrEqual(2);
      expect(data.items.reduce((s, i) => s + i.lineTotalPaise, 0)).toBe(data.subtotalPaise);
      for (const i of data.items) expect(i.lineTotalPaise).toBe(i.unitPricePaise * i.quantity);
      const tax = data.gst ? data.gst.cgstPaise + data.gst.sgstPaise : 0;
      const exclusive = data.gst !== null && !data.gst.inclusive;
      expect(data.totalPaise).toBe(
        data.subtotalPaise - data.discountPaise + (exclusive ? tax : 0) + data.roundOffPaise,
      );
      expect(data.totalPaise).toBeGreaterThan(0);
    }
  });

  it("uses the passed shop, header and footer", () => {
    const data = sampleReceiptData(shop, text);
    expect(data.shop).toEqual(shop);
    expect(data.header).toBe("Welcome!");
    expect(data.footer).toBe("Thank you, visit again");
  });

  it("is neutral without settings: empty title, no GST", () => {
    const data = sampleReceiptData(shop, text);
    expect(data.title).toBe("");
    expect(data.gst).toBeNull();
  });

  it("fills the gst block from calculateTotals (exclusive)", () => {
    const gst = { enabled: true, rateBp: 1800, inclusive: false };
    const data = sampleReceiptData(shop, text, {
      receiptTitle: "Tax Invoice",
      gstEnabled: true,
      gstRateBp: 1800,
      gstInclusive: false,
    });
    const t = recompute(data, gst);
    expect(data.title).toBe("Tax Invoice");
    expect(data.gst).toEqual({
      inclusive: false,
      rateBp: 1800,
      taxablePaise: t.taxablePaise,
      cgstPaise: t.cgstPaise,
      sgstPaise: t.sgstPaise,
    });
    expect(data.totalPaise).toBe(t.totalPaise);
    expect(t.cgstPaise + t.sgstPaise).toBeGreaterThan(0);
  });

  it("fills the gst block from calculateTotals (inclusive)", () => {
    const gst = { enabled: true, rateBp: 500, inclusive: true };
    const data = sampleReceiptData(shop, text, {
      receiptTitle: "",
      gstEnabled: true,
      gstRateBp: 500,
      gstInclusive: true,
    });
    const t = recompute(data, gst);
    expect(data.gst).toEqual({
      inclusive: true,
      rateBp: 500,
      taxablePaise: t.taxablePaise,
      cgstPaise: t.cgstPaise,
      sgstPaise: t.sgstPaise,
    });
    expect(data.totalPaise).toBe(t.totalPaise);
  });

  it("has no gst block when GST is disabled", () => {
    const data = sampleReceiptData(shop, text, {
      receiptTitle: "Bill of Supply",
      gstEnabled: false,
      gstRateBp: 1800,
      gstInclusive: false,
    });
    expect(data.gst).toBeNull();
    expect(data.title).toBe("Bill of Supply");
  });

  it("is deterministic", () => {
    expect(sampleReceiptData(shop, text)).toEqual(sampleReceiptData(shop, text));
  });

  it("renders as a test print, never a reprint", () => {
    for (const width of [58, 80] as const) {
      const html = renderReceiptHtml(sampleReceiptData(shop, text), width);
      expect(html).toContain("TEST PRINT - NOT A BILL");
      expect(html).not.toContain("REPRINT");
      expect(html).toContain(`size: ${width}mm`);
    }
  });
});
