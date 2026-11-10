import { describe, expect, it } from "vitest";
import type { BillDetail } from "@/modules/bills/types";
import { buildReceiptData, type ReceiptData } from "@/modules/printing/receipt";
import { escapeHtml, renderReceiptHtml } from "@/modules/printing/render-html";

function makeBill(overrides: Partial<BillDetail> = {}): BillDetail {
  return {
    id: "b1",
    billNumber: 42,
    billNumberDisplay: "INV-2627-000042",
    tokenNumber: 17,
    businessDate: "2026-11-10",
    status: "COMPLETED",
    createdAt: new Date("2026-11-09T20:30:00Z"),
    items: [
      { productName: "Masala Chai", categoryName: "Tea", unitPricePaise: 1500, quantity: 2, lineTotalPaise: 3000 },
      { productName: "Samosa", categoryName: "Snacks", unitPricePaise: 2000, quantity: 1, lineTotalPaise: 2000 },
    ],
    subtotalPaise: 5000,
    discountType: null,
    discountValue: 0,
    discountPaise: 0,
    taxablePaise: 5000,
    cgstPaise: 0,
    sgstPaise: 0,
    taxPaise: 0,
    taxIncluded: true,
    roundOffPaise: 0,
    totalPaise: 5000,
    payment: {
      method: "CASH",
      amountPaise: 5000,
      cashTenderedPaise: 10000,
      changePaise: 5000,
      upiReference: null,
      status: "RECORDED",
    },
    customerName: null,
    customerPhone: null,
    printCount: 0,
    cancelledAt: null,
    cancelReason: null,
    shopSnapshot: { name: "Chai Point", address: "12 MG Road", phone: "9876543210", gstin: null },
    gstSnapshot: { enabled: false, rateBp: 0, inclusive: true, title: "Tax Invoice" },
    ...overrides,
  };
}

const TEXT = { header: "Welcome", footer: "Thank you" };

function receipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return { ...buildReceiptData(makeBill(), TEXT, { isReprint: false }), ...overrides };
}

const NASTY = `<script>alert(1)</script> & "x"`;

describe("buildReceiptData", () => {
  it("copies bill fields and uses snapshots for shop details", () => {
    const bill = makeBill({
      shopSnapshot: { name: "Old Name", address: "Old Addr", phone: "111", gstin: "29ABCDE1234F1Z5" },
    });
    const data = buildReceiptData(bill, TEXT, { isReprint: true });
    expect(data.shop).toEqual({ name: "Old Name", address: "Old Addr", phone: "111", gstin: "29ABCDE1234F1Z5" });
    expect(data.billNumberDisplay).toBe("INV-2627-000042");
    expect(data.tokenNumber).toBe(17);
    expect(data.dateTime).toBe("10 Nov 2026, 02:00 am");
    expect(data.isReprint).toBe(true);
    expect(data.isSample).toBe(false);
    expect(data.title).toBe("Tax Invoice");
    expect(data.header).toBe("Welcome");
    expect(data.footer).toBe("Thank you");
    expect(data.items).toEqual([
      { name: "Masala Chai", quantity: 2, unitPricePaise: 1500, lineTotalPaise: 3000 },
      { name: "Samosa", quantity: 1, unitPricePaise: 2000, lineTotalPaise: 2000 },
    ]);
  });

  it("gst is null when disabled, and uses stored amounts when enabled", () => {
    expect(buildReceiptData(makeBill(), TEXT, { isReprint: false }).gst).toBeNull();
    const bill = makeBill({
      gstSnapshot: { enabled: true, rateBp: 500, inclusive: false, title: "Tax Invoice" },
      taxablePaise: 4762,
      cgstPaise: 119,
      sgstPaise: 119,
      taxPaise: 238,
      taxIncluded: false,
    });
    expect(buildReceiptData(bill, TEXT, { isReprint: false }).gst).toEqual({
      inclusive: false,
      rateBp: 500,
      taxablePaise: 4762,
      cgstPaise: 119,
      sgstPaise: 119,
    });
  });

  it("maps cash and UPI payment fields", () => {
    const cash = buildReceiptData(makeBill(), TEXT, { isReprint: false });
    expect(cash.paymentMethod).toBe("CASH");
    expect(cash.cashTenderedPaise).toBe(10000);
    expect(cash.changePaise).toBe(5000);
    const upi = buildReceiptData(
      makeBill({
        payment: {
          method: "UPI",
          amountPaise: 5000,
          cashTenderedPaise: null,
          changePaise: null,
          upiReference: "REF1",
          status: "RECORDED",
        },
      }),
      TEXT,
      { isReprint: false },
    );
    expect(upi.paymentMethod).toBe("UPI");
    expect(upi.cashTenderedPaise).toBeNull();
    expect(upi.changePaise).toBeNull();
  });
});

describe("renderReceiptHtml", () => {
  it("shows the bill number and the token inside .token", () => {
    const html = renderReceiptHtml(receipt(), 58);
    expect(html).toContain("INV-2627-000042");
    expect(html).toMatch(/<[a-z0-9]+ class="token"[^>]*>\s*17\s*<\/[a-z0-9]+>/);
  });

  it("puts the token before the item list", () => {
    const html = renderReceiptHtml(receipt(), 58);
    expect(html.indexOf('class="token"')).toBeLessThan(html.indexOf("Masala Chai"));
  });

  it("is a complete document with no script, no external resources and no background colours", () => {
    const html = renderReceiptHtml(receipt(), 58);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<link|<img|@import|url\(/i);
    expect(html).not.toMatch(/background/i);
  });

  it("58mm layout", () => {
    const html = renderReceiptHtml(receipt(), 58);
    expect(html).toContain("size: 58mm auto");
    expect(html).toContain("margin: 0");
    expect(html).toContain("48mm");
    expect(html).not.toContain("72mm");
    expect(html).toContain("monospace");
  });

  it("80mm layout", () => {
    const html = renderReceiptHtml(receipt(), 80);
    expect(html).toContain("size: 80mm auto");
    expect(html).toContain("72mm");
    expect(html).not.toContain("48mm");
  });

  it("escapes product names", () => {
    const data = receipt({ items: [{ name: NASTY, quantity: 1, unitPricePaise: 100, lineTotalPaise: 100 }] });
    const html = renderReceiptHtml(data, 58);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain(NASTY);
  });

  it("escapes the customer name", () => {
    const html = renderReceiptHtml(receipt({ customerName: NASTY }), 80);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;");
    expect(html).not.toContain("<script");
  });

  it("escapes shop details, title, header and footer", () => {
    const data = receipt({
      shop: { name: NASTY, address: NASTY, phone: NASTY, gstin: NASTY },
      title: NASTY,
      gst: { inclusive: true, rateBp: 500, taxablePaise: 100, cgstPaise: 1, sgstPaise: 1 },
      header: NASTY,
      footer: NASTY,
    });
    const html = renderReceiptHtml(data, 58);
    expect(html).not.toContain("<script");
    expect(html.match(/&lt;script&gt;/g)?.length).toBe(7);
  });

  it("shows the title only on GST receipts", () => {
    expect(renderReceiptHtml(receipt(), 58)).not.toContain("Tax Invoice");
    const gst = { inclusive: true, rateBp: 500, taxablePaise: 100, cgstPaise: 1, sgstPaise: 1 };
    expect(renderReceiptHtml(receipt({ gst }), 58)).toContain("Tax Invoice");
  });

  it("renders header and footer newlines as separate escaped lines", () => {
    const html = renderReceiptHtml(receipt({ header: "Line A\nLine <B>", footer: "Foot 1\nFoot 2" }), 58);
    expect(html).toMatch(/<div class="line">Line A<\/div>\s*<div class="line">Line &lt;B&gt;<\/div>/);
    expect(html).toMatch(/<div class="line">Foot 1<\/div>\s*<div class="line">Foot 2<\/div>/);
  });

  it("escapeHtml escapes & < > double quote and single quote", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("renders a 150-character name and an emoji name with the overflow-wrap rule", () => {
    const long = "A".repeat(150);
    const data = receipt({
      items: [
        { name: long, quantity: 1, unitPricePaise: 100, lineTotalPaise: 100 },
        { name: "Chai ☕🍵 \u{1F600}", quantity: 3, unitPricePaise: 100, lineTotalPaise: 300 },
      ],
    });
    for (const width of [58, 80] as const) {
      const html = renderReceiptHtml(data, width);
      expect(html).toContain(long);
      expect(html).toContain("☕");
      expect(html).toContain("overflow-wrap: anywhere");
    }
  });

  it("shows qty x price and line total for each item", () => {
    const html = renderReceiptHtml(receipt(), 58);
    expect(html).toContain("2 x ₹15.00");
    expect(html).toContain("₹30.00");
  });

  it("shows GST lines only when gst is non-null", () => {
    expect(renderReceiptHtml(receipt(), 58)).not.toMatch(/CGST|SGST/);
    const html = renderReceiptHtml(
      receipt({ gst: { inclusive: false, rateBp: 500, taxablePaise: 4762, cgstPaise: 119, sgstPaise: 119 } }),
      58,
    );
    expect(html).toContain("CGST 2.5%");
    expect(html).toContain("SGST 2.5%");
    expect(html).toContain("₹47.62");
    expect(html).toContain("₹1.19");
  });

  it("formats half rates without floating point artefacts", () => {
    const rate = (rateBp: number) =>
      renderReceiptHtml(
        receipt({ gst: { inclusive: true, rateBp, taxablePaise: 100, cgstPaise: 1, sgstPaise: 1 } }),
        58,
      );
    expect(rate(250)).toContain("CGST 1.25%");
    expect(rate(300)).toContain("CGST 1.5%");
    expect(rate(1800)).toContain("CGST 9%");
    expect(rate(1200)).toContain("SGST 6%");
    expect(rate(500)).toContain("SGST 2.5%");
  });

  it("shows the discount line only when discountPaise > 0", () => {
    expect(renderReceiptHtml(receipt(), 58)).not.toMatch(/Discount/);
    const html = renderReceiptHtml(receipt({ discountPaise: 500 }), 58);
    expect(html).toContain("Discount");
    expect(html).toContain("-₹5.00");
  });

  it("shows round off only when non-zero", () => {
    expect(renderReceiptHtml(receipt(), 58)).not.toMatch(/Round off/);
    expect(renderReceiptHtml(receipt({ roundOffPaise: -20 }), 58)).toMatch(/Round off/);
  });

  it("shows CANCELLED only for cancelled bills", () => {
    expect(renderReceiptHtml(receipt(), 58)).not.toContain("CANCELLED");
    expect(renderReceiptHtml(receipt({ status: "CANCELLED" }), 58)).toContain("CANCELLED");
  });

  it("shows REPRINT only for reprints", () => {
    expect(renderReceiptHtml(receipt(), 58)).not.toContain("REPRINT");
    expect(renderReceiptHtml(receipt({ isReprint: true }), 58)).toContain("REPRINT");
  });

  it("shows the sample marker only for sample data", () => {
    expect(renderReceiptHtml(receipt(), 58)).not.toContain("TEST PRINT - NOT A BILL");
    expect(renderReceiptHtml(receipt({ isSample: true }), 58)).toContain("TEST PRINT - NOT A BILL");
  });

  it("shows tendered and change for cash, neither for UPI", () => {
    const cash = renderReceiptHtml(receipt(), 58);
    expect(cash).toContain("Cash");
    expect(cash).toContain("Tendered");
    expect(cash).toContain("₹100.00");
    expect(cash).toContain("Change");
    expect(cash).toContain("₹50.00");
    const upi = renderReceiptHtml(receipt({ paymentMethod: "UPI", cashTenderedPaise: null, changePaise: null }), 58);
    expect(upi).toContain("UPI");
    expect(upi).not.toContain("Tendered");
    expect(upi).not.toContain("Change");
  });

  it("shows GSTIN only when set, and the customer only when present", () => {
    expect(renderReceiptHtml(receipt(), 58)).not.toContain("GSTIN");
    expect(renderReceiptHtml(receipt(), 58)).not.toContain("Customer");
    const html = renderReceiptHtml(
      receipt({ shop: { name: "S", address: "A", phone: "1", gstin: "29ABCDE1234F1Z5" }, customerName: "Ravi" }),
      58,
    );
    expect(html).toContain("GSTIN: 29ABCDE1234F1Z5");
    expect(html).toContain("Customer: Ravi");
  });

  it("takes shop details from the stored snapshot even when current settings differ", () => {
    const bill = makeBill({ shopSnapshot: { name: "Snapshot Cafe", address: "A", phone: "1", gstin: null } });
    // buildReceiptData has no settings parameter for shop details, so a changed settings object cannot leak in.
    const currentSettings = { shopName: "Brand New Cafe" };
    const html = renderReceiptHtml(buildReceiptData(bill, TEXT, { isReprint: true }), 80);
    expect(html).toContain("Snapshot Cafe");
    expect(html).not.toContain(currentSettings.shopName);
  });
});
