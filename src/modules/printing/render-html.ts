import { formatPaise } from "@/lib/money";
import type { ReceiptData } from "./receipt";

/** The one escaping function for every dynamic string that reaches the receipt HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Half of a GST rate given in basis points, as a percent string using integer math: 250 -> "1.25", 500 -> "2.5", 1800 -> "9". */
function halfRatePercent(rateBp: number): string {
  const thousandths = rateBp * 5; // rateBp / 2 bp = rateBp / 200 percent = rateBp * 5 / 1000
  const whole = Math.floor(thousandths / 1000);
  const frac = String(thousandths % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

const e = escapeHtml;

function lines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => `<div class="line">${e(l)}</div>`)
    .join("\n");
}

function row(label: string, value: string, cls = "row"): string {
  return `<div class="${cls}"><span>${e(label)}</span><span class="amt">${e(value)}</span></div>`;
}

function css(paperWidth: 58 | 80): string {
  const bodyWidth = paperWidth === 58 ? "48mm" : "72mm";
  return `
@page { size: ${paperWidth}mm auto; margin: 0 }
* { box-sizing: border-box; }
html { margin: 0; padding: 0; }
body { width: ${bodyWidth}; margin: 0; padding: 2mm 1mm; color: #000; font-family: "Courier New", Courier, monospace; font-size: 12px; line-height: 1.3; }
.center { text-align: center; }
.line { overflow-wrap: anywhere; }
.title { font-weight: bold; }
.shop { font-size: 15px; font-weight: bold; text-align: center; overflow-wrap: anywhere; }
.marker { border: 2px solid #000; text-align: center; font-weight: bold; font-size: 15px; padding: 1mm 0; margin: 1mm 0; }
.token-label { text-align: center; font-weight: bold; font-size: 12px; margin-top: 2mm; }
.token { text-align: center; font-weight: 900; font-size: 52px; line-height: 1.1; margin-bottom: 1mm; }
.rule { border-top: 1px dashed #000; margin: 1.5mm 0; }
.item-name { overflow-wrap: anywhere; font-weight: bold; }
.row { display: flex; justify-content: space-between; gap: 2mm; }
.row .amt { white-space: nowrap; text-align: right; }
.item-calc { padding-left: 2mm; }
.total { font-size: 15px; font-weight: bold; }
`;
}

export function renderReceiptHtml(data: ReceiptData, paperWidth: 58 | 80): string {
  const out: string[] = [];

  if (data.isSample) out.push(`<div class="marker">TEST PRINT - NOT A BILL</div>`);
  if (data.status === "CANCELLED") out.push(`<div class="marker">CANCELLED</div>`);
  if (data.isReprint) out.push(`<div class="marker">REPRINT</div>`);

  out.push(`<div class="token-label">TOKEN</div>`);
  out.push(`<div class="token">${e(String(data.tokenNumber))}</div>`);

  out.push(`<div class="shop">${e(data.shop.name)}</div>`);
  if (data.shop.address.trim()) out.push(lines(data.shop.address));
  if (data.shop.phone.trim()) out.push(`<div class="line center">${e(data.shop.phone)}</div>`);
  if (data.shop.gstin) out.push(`<div class="line center">GSTIN: ${e(data.shop.gstin)}</div>`);
  if (data.header.trim()) out.push(`<div class="center">${lines(data.header)}</div>`);
  // Owner-configured heading ("Tax Invoice", "Bill of Supply", ...), printed whenever non-empty.
  if (data.title.trim()) out.push(`<div class="line center title">${e(data.title.trim())}</div>`);

  out.push(`<div class="rule"></div>`);
  out.push(`<div class="line">Bill: ${e(data.billNumberDisplay)}</div>`);
  out.push(`<div class="line">${e(data.dateTime)}</div>`);
  if (data.customerName) out.push(`<div class="line">Customer: ${e(data.customerName)}</div>`);
  out.push(`<div class="rule"></div>`);

  for (const item of data.items) {
    out.push(`<div class="item">`);
    out.push(`<div class="item-name">${e(item.name)}</div>`);
    out.push(
      `<div class="row item-calc"><span>${e(`${item.quantity} x ${formatPaise(item.unitPricePaise)}`)}</span><span class="amt">${e(formatPaise(item.lineTotalPaise))}</span></div>`,
    );
    out.push(`</div>`);
  }

  out.push(`<div class="rule"></div>`);
  out.push(row("Subtotal", formatPaise(data.subtotalPaise)));
  if (data.discountPaise > 0) out.push(row("Discount", `-${formatPaise(data.discountPaise)}`));
  if (data.gst) {
    const pct = halfRatePercent(data.gst.rateBp);
    out.push(row("Taxable value", formatPaise(data.gst.taxablePaise)));
    out.push(row(`CGST ${pct}%`, formatPaise(data.gst.cgstPaise)));
    out.push(row(`SGST ${pct}%`, formatPaise(data.gst.sgstPaise)));
    // Inclusive pricing: the tax is already inside the subtotal, so say so (otherwise the
    // receipt reads like an arithmetic error: Subtotal == TOTAL despite CGST/SGST lines).
    if (data.gst.inclusive) out.push(`<div class="line">Prices include GST</div>`);
  }
  if (data.roundOffPaise !== 0) out.push(row("Round off", formatPaise(data.roundOffPaise)));
  out.push(row("TOTAL", formatPaise(data.totalPaise), "row total"));
  out.push(`<div class="rule"></div>`);

  out.push(row("Paid by", data.paymentMethod === "CASH" ? "Cash" : "UPI"));
  if (data.paymentMethod === "CASH") {
    if (data.cashTenderedPaise !== null) out.push(row("Tendered", formatPaise(data.cashTenderedPaise)));
    if (data.changePaise !== null) out.push(row("Change", formatPaise(data.changePaise)));
  }

  if (data.footer.trim()) {
    out.push(`<div class="rule"></div>`);
    out.push(`<div class="center">${lines(data.footer)}</div>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Receipt</title>
<style>${css(paperWidth)}</style>
</head>
<body>
${out.join("\n")}
</body>
</html>
`;
}
