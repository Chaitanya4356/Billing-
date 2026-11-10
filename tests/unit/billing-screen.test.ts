import { afterEach, describe, expect, it, vi } from "vitest";
import { createBillSchema } from "@/modules/billing/schema";
import {
  buildCreateBillInput,
  describeReplayMismatch,
  newIdempotencyKey,
  parseCashText,
  parseDiscountText,
  replayWarning,
  searchProducts,
} from "@/modules/billing/screen";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newIdempotencyKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns distinct v4 uuids", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it("falls back to getRandomValues where randomUUID is missing (insecure context)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    const key = newIdempotencyKey();
    expect(key).toMatch(UUID_V4);
    expect(createBillSchema.shape.idempotencyKey.safeParse(key).success).toBe(true);
  });
});

describe("parseDiscountText", () => {
  it("blank or zero is no discount", () => {
    expect(parseDiscountText("FLAT", "")).toEqual({ ok: true, discount: null });
    expect(parseDiscountText("FLAT", "  ")).toEqual({ ok: true, discount: null });
    expect(parseDiscountText("FLAT", "0")).toEqual({ ok: true, discount: null });
    expect(parseDiscountText("PERCENT", "0.00")).toEqual({ ok: true, discount: null });
  });

  it("flat rupees become paise", () => {
    expect(parseDiscountText("FLAT", "12.5")).toEqual({ ok: true, discount: { type: "FLAT", value: 1250 } });
    expect(parseDiscountText("FLAT", "₹5")).toEqual({ ok: true, discount: { type: "FLAT", value: 500 } });
  });

  it("percent becomes basis points", () => {
    expect(parseDiscountText("PERCENT", "10")).toEqual({ ok: true, discount: { type: "PERCENT", value: 1000 } });
    expect(parseDiscountText("PERCENT", "12.5")).toEqual({ ok: true, discount: { type: "PERCENT", value: 1250 } });
  });

  it("invalid text is an error, never silently no discount", () => {
    expect(parseDiscountText("FLAT", "12.5.5").ok).toBe(false);
    expect(parseDiscountText("FLAT", "-5").ok).toBe(false);
    expect(parseDiscountText("PERCENT", "101").ok).toBe(false);
    expect(parseDiscountText("PERCENT", "abc").ok).toBe(false);
  });
});

describe("parseCashText", () => {
  it("blank is not entered yet", () => {
    expect(parseCashText("")).toEqual({ ok: true, paise: null });
  });
  it("parses rupees into paise", () => {
    expect(parseCashText("50")).toEqual({ ok: true, paise: 5000 });
    expect(parseCashText("12.50")).toEqual({ ok: true, paise: 1250 });
  });
  it("rejects 12.5.5 and other junk", () => {
    expect(parseCashText("12.5.5").ok).toBe(false);
    expect(parseCashText("1.234").ok).toBe(false);
    expect(parseCashText("abc").ok).toBe(false);
  });
});

describe("searchProducts", () => {
  const products = [
    { id: "1", name: "Masala Tea", shortCode: "MT" },
    { id: "2", name: "Samosa", shortCode: null },
    { id: "3", name: "Mt Dew", shortCode: "DEW" },
  ];

  it("matches name substrings case-insensitively, in catalog order", () => {
    expect(searchProducts(products, "SAM").map((p) => p.id)).toEqual(["2"]);
    expect(searchProducts(products, "a").map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("puts an exact short code match first", () => {
    expect(searchProducts(products, "mt").map((p) => p.id)).toEqual(["1", "3"]);
    expect(searchProducts(products, "dew").map((p) => p.id)).toEqual(["3"]);
  });

  it("does not match a short code prefix and returns nothing for a blank query", () => {
    const withCoffee = [...products, { id: "4", name: "Coffee", shortCode: "CFX" }];
    expect(searchProducts(withCoffee, "cf")).toEqual([]);
    expect(searchProducts(withCoffee, "CFX").map((p) => p.id)).toEqual(["4"]);
    expect(searchProducts(products, "  ")).toEqual([]);
  });
});

describe("buildCreateBillInput", () => {
  const cart = {
    idempotencyKey: "4f0c1b2a-1111-4222-8333-444455556666",
    discount: { type: "PERCENT" as const, value: 1000 },
    lines: [
      { productId: "0b0e9b9e-0000-4000-8000-000000000001", name: "Tea", unitPricePaise: 1500, quantity: 2 },
      { productId: "0b0e9b9e-0000-4000-8000-000000000002", name: "Samosa", unitPricePaise: 1500, quantity: 1 },
    ],
  };

  it("builds a cash request the server schema accepts, with the displayed prices and total only as expectations", () => {
    const input = buildCreateBillInput({
      cart,
      displayedTotalPaise: 4050,
      payment: { method: "CASH", cashTenderedPaise: 5000 },
      customerName: "  ",
      customerPhone: "",
    });
    expect(input).toEqual({
      idempotencyKey: cart.idempotencyKey,
      items: [
        { productId: cart.lines[0].productId, quantity: 2, expectedUnitPricePaise: 1500 },
        { productId: cart.lines[1].productId, quantity: 1, expectedUnitPricePaise: 1500 },
      ],
      discount: { type: "PERCENT", value: 1000 },
      expectedTotalPaise: 4050,
      payment: { method: "CASH", cashTenderedPaise: 5000 },
      customerName: null,
      customerPhone: null,
    });
    expect(createBillSchema.safeParse(input).success).toBe(true);
  });

  it("builds a confirmed UPI request; a blank reference is null", () => {
    const upi = buildCreateBillInput({
      cart: { ...cart, discount: null },
      displayedTotalPaise: 4500,
      payment: { method: "UPI", reference: " " },
      customerName: " Ravi ",
      customerPhone: "",
    });
    expect(upi.payment).toEqual({ method: "UPI", confirmed: true, reference: null });
    expect(upi.discount).toBeNull();
    expect(upi.customerName).toBe("Ravi");
    expect(createBillSchema.safeParse(upi).success).toBe(true);
  });
});

describe("describeReplayMismatch / replayWarning", () => {
  const items = [
    { name: "Tea", quantity: 2, unitPricePaise: 1500 },
    { name: "Samosa", quantity: 1, unitPricePaise: 2000 },
  ];
  const submitted = { method: "CASH" as const, items, expectedTotalPaise: 5000 };
  const bill = (over: Partial<{ method: "CASH" | "UPI"; items: typeof items; totalPaise: number }> = {}) => ({
    payment: { method: over.method ?? ("CASH" as const) },
    items: (over.items ?? items).map((i) => ({
      productName: i.name,
      quantity: i.quantity,
      unitPricePaise: i.unitPricePaise,
    })),
    totalPaise: over.totalPaise ?? 5000,
  });

  it("returns no differences for the same method and items", () => {
    expect(describeReplayMismatch(submitted, bill())).toEqual([]);
    expect(replayWarning(submitted, bill())).toBeNull();
  });

  it("ignores item order", () => {
    expect(describeReplayMismatch(submitted, bill({ items: [items[1], items[0]] }))).toEqual([]);
  });

  it("reports a different payment method", () => {
    expect(describeReplayMismatch({ ...submitted, method: "UPI" }, bill())).toEqual([
      "Saved as CASH but you chose UPI.",
    ]);
    expect(describeReplayMismatch(submitted, bill({ method: "UPI" }))).toEqual(["Saved as UPI but you chose CASH."]);
  });

  it("reports a different quantity", () => {
    const changed = [{ ...items[0], quantity: 3 }, items[1]];
    expect(describeReplayMismatch(submitted, bill({ items: changed }))).toEqual(["Saved items differ from the cart."]);
  });

  it("reports a different unit price", () => {
    const changed = [{ ...items[0], unitPricePaise: 1600 }, items[1]];
    expect(describeReplayMismatch(submitted, bill({ items: changed }))).toEqual(["Saved items differ from the cart."]);
  });

  it("reports an extra or a missing item", () => {
    const extra = [...items, { name: "Coffee", quantity: 1, unitPricePaise: 2500 }];
    expect(describeReplayMismatch(submitted, bill({ items: extra }))).toEqual(["Saved items differ from the cart."]);
    expect(describeReplayMismatch(submitted, bill({ items: [items[0]] }))).toEqual([
      "Saved items differ from the cart.",
    ]);
  });

  it("treats a repeated line as different from a single line (multiset)", () => {
    const dup = [items[0], items[0]];
    const sub = { ...submitted, items: [items[0], items[1]] };
    expect(describeReplayMismatch(sub, bill({ items: dup }))).toEqual(["Saved items differ from the cart."]);
  });

  it("keeps the current total-only message", () => {
    expect(describeReplayMismatch(submitted, bill({ totalPaise: 5200 }))).toEqual([]);
    expect(replayWarning(submitted, bill({ totalPaise: 5200 }))).toBe(
      "This bill was already saved by an earlier attempt, with a total of ₹52.00 (the screen showed ₹50.00). Collect ₹52.00.",
    );
  });

  it("says what differs and how to fix it", () => {
    const w = replayWarning({ ...submitted, method: "UPI" }, bill());
    expect(w).toContain("This bill was already saved by an earlier attempt");
    expect(w).toContain("Saved as CASH but you chose UPI.");
    expect(w).toContain("Review it, and if it is wrong, cancel it from Bills and charge again.");
    expect(w).not.toContain("Collect");
  });

  it("combines a total difference with other differences", () => {
    const w = replayWarning({ ...submitted, method: "UPI" }, bill({ totalPaise: 5200 }));
    expect(w).toContain("Saved as CASH but you chose UPI.");
    expect(w).toContain("Collect ₹52.00");
    expect(w).toContain("cancel it from Bills and charge again.");
  });
});
