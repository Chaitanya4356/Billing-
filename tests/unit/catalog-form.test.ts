import { describe, expect, it } from "vitest";
import { buildProductInput } from "@/modules/catalog/form-parse";

const CAT = "11111111-1111-4111-8111-111111111111";
const base = { name: "Masala Tea", priceText: "15", shortCode: "", categoryId: CAT };

describe("buildProductInput", () => {
  it("parses rupees into paise and blank short code into null", () => {
    expect(buildProductInput(base)).toEqual({
      value: { name: "Masala Tea", categoryId: CAT, pricePaise: 1500, shortCode: null },
    });
    expect(buildProductInput({ ...base, priceText: "₹12.5", shortCode: " mt1 " })).toEqual({
      value: { name: "Masala Tea", categoryId: CAT, pricePaise: 1250, shortCode: "mt1" },
    });
  });

  it("allows a price of 0", () => {
    expect(buildProductInput({ ...base, priceText: "0" })).toMatchObject({ value: { pricePaise: 0 } });
    expect(buildProductInput({ ...base, priceText: "0.00" })).toMatchObject({ value: { pricePaise: 0 } });
  });

  it.each(["", "   ", "abc", "12.345", "-5", "1e3"])("price %j is an inline price error", (priceText) => {
    const r = buildProductInput({ ...base, priceText });
    expect("errors" in r && r.errors.price).toBeTruthy();
  });

  it("rejects a price above the maximum", () => {
    const r = buildProductInput({ ...base, priceText: "100000.01" });
    expect("errors" in r && r.errors.price).toMatch(/too high/i);
    expect(buildProductInput({ ...base, priceText: "100000" })).toMatchObject({
      value: { pricePaise: 10_000_000 },
    });
  });

  it("reports name, short code and category errors together", () => {
    const r = buildProductInput({ name: "  ", priceText: "5", shortCode: "a-b", categoryId: "" });
    expect("errors" in r).toBe(true);
    if ("errors" in r) {
      expect(Object.keys(r.errors).sort()).toEqual(["categoryId", "name", "shortCode"]);
    }
  });
});
