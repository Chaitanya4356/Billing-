import { describe, expect, it } from "vitest";
import { calculateTotals } from "@/modules/billing/calc";
import {
  cartReducer,
  initialCart,
  selectTotals,
  type CartAction,
  type CartState,
} from "@/modules/billing/cart";

const CFG = { gstEnabled: false, gstRateBp: 0, gstInclusive: false, roundToRupee: false };
const P1 = { id: "p1", name: "Tea", pricePaise: 1500 };
const P2 = { id: "p2", name: "Coffee", pricePaise: 2500 };

function keys() {
  let n = 0;
  return () => `key-${++n}`;
}

function run(actions: CartAction[], newKey = keys()): CartState {
  return actions.reduce((s, a) => cartReducer(s, a, newKey), initialCart(newKey));
}

describe("initialCart", () => {
  it("starts empty with a generated key", () => {
    const s = initialCart(() => "k0");
    expect(s).toEqual({ lines: [], discount: null, idempotencyKey: "k0" });
  });
});

describe("ADD_PRODUCT", () => {
  it("adds a new line with quantity 1", () => {
    const s = run([{ type: "ADD_PRODUCT", product: P1 }]);
    expect(s.lines).toEqual([{ productId: "p1", name: "Tea", unitPricePaise: 1500, quantity: 1 }]);
  });

  it("adding the same product twice gives quantity 2 on one line", () => {
    const s = run([
      { type: "ADD_PRODUCT", product: P1 },
      { type: "ADD_PRODUCT", product: P1 },
    ]);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].quantity).toBe(2);
  });

  it("clamps at 999 and returns the same reference when already at 999", () => {
    const s = run([
      { type: "ADD_PRODUCT", product: P1 },
      { type: "SET_QUANTITY", productId: "p1", quantity: 999 },
    ]);
    expect(s.lines[0].quantity).toBe(999);
    const next = cartReducer(s, { type: "ADD_PRODUCT", product: P1 }, keys());
    expect(next).toBe(s);
    expect(next.lines[0].quantity).toBe(999);
  });

  it("does not mutate the previous state", () => {
    const s1 = run([{ type: "ADD_PRODUCT", product: P1 }]);
    const snapshot = JSON.parse(JSON.stringify(s1));
    cartReducer(s1, { type: "ADD_PRODUCT", product: P1 }, keys());
    expect(s1).toEqual(snapshot);
  });
});

describe("SET_QUANTITY", () => {
  const base = () =>
    run([
      { type: "ADD_PRODUCT", product: P1 },
      { type: "ADD_PRODUCT", product: P2 },
    ]);

  it("sets a valid quantity", () => {
    const s = cartReducer(base(), { type: "SET_QUANTITY", productId: "p1", quantity: 5 }, keys());
    expect(s.lines[0].quantity).toBe(5);
    expect(s.lines[1].quantity).toBe(1);
  });

  it("0 removes the line", () => {
    const s = cartReducer(base(), { type: "SET_QUANTITY", productId: "p1", quantity: 0 }, keys());
    expect(s.lines.map((l) => l.productId)).toEqual(["p2"]);
  });

  it("negative removes the line", () => {
    const s = cartReducer(base(), { type: "SET_QUANTITY", productId: "p2", quantity: -3 }, keys());
    expect(s.lines.map((l) => l.productId)).toEqual(["p1"]);
  });

  it("above 999 is clamped to 999", () => {
    const s = cartReducer(base(), { type: "SET_QUANTITY", productId: "p1", quantity: 5000 }, keys());
    expect(s.lines[0].quantity).toBe(999);
  });

  it("non-integer and NaN are ignored (same reference)", () => {
    const b = base();
    for (const q of [1.5, NaN, Infinity, -Infinity]) {
      expect(cartReducer(b, { type: "SET_QUANTITY", productId: "p1", quantity: q }, keys())).toBe(b);
    }
  });

  it("unknown productId returns the same reference", () => {
    const b = base();
    expect(cartReducer(b, { type: "SET_QUANTITY", productId: "nope", quantity: 3 }, keys())).toBe(b);
    expect(cartReducer(b, { type: "SET_QUANTITY", productId: "nope", quantity: 0 }, keys())).toBe(b);
  });

  it("same quantity returns the same reference", () => {
    const b = base();
    expect(cartReducer(b, { type: "SET_QUANTITY", productId: "p1", quantity: 1 }, keys())).toBe(b);
  });
});

describe("REMOVE", () => {
  it("drops the line", () => {
    const s = run([
      { type: "ADD_PRODUCT", product: P1 },
      { type: "ADD_PRODUCT", product: P2 },
      { type: "REMOVE", productId: "p1" },
    ]);
    expect(s.lines.map((l) => l.productId)).toEqual(["p2"]);
  });

  it("unknown productId returns the same reference", () => {
    const b = run([{ type: "ADD_PRODUCT", product: P1 }]);
    expect(cartReducer(b, { type: "REMOVE", productId: "nope" }, keys())).toBe(b);
  });
});

describe("SET_DISCOUNT", () => {
  const base = () => run([{ type: "ADD_PRODUCT", product: P1 }]);

  it("stores a valid discount", () => {
    const s = cartReducer(base(), { type: "SET_DISCOUNT", discount: { type: "FLAT", value: 100 } }, keys());
    expect(s.discount).toEqual({ type: "FLAT", value: 100 });
  });

  it("null clears the discount", () => {
    const withD = cartReducer(base(), { type: "SET_DISCOUNT", discount: { type: "PERCENT", value: 500 } }, keys());
    expect(cartReducer(withD, { type: "SET_DISCOUNT", discount: null }, keys()).discount).toBeNull();
  });

  it("a discount of value 0 is stored as null (no discount)", () => {
    const withD = cartReducer(base(), { type: "SET_DISCOUNT", discount: { type: "FLAT", value: 100 } }, keys());
    for (const type of ["FLAT", "PERCENT"] as const) {
      expect(cartReducer(withD, { type: "SET_DISCOUNT", discount: { type, value: 0 } }, keys()).discount).toBeNull();
    }
  });

  it("negative, fractional and NaN values are stored as null", () => {
    for (const value of [-5, 1.5, NaN, Infinity]) {
      expect(
        cartReducer(base(), { type: "SET_DISCOUNT", discount: { type: "FLAT", value } }, keys()).discount,
      ).toBeNull();
    }
  });

  it("returns the same reference when nothing changes", () => {
    const b = base();
    expect(cartReducer(b, { type: "SET_DISCOUNT", discount: null }, keys())).toBe(b);
    expect(cartReducer(b, { type: "SET_DISCOUNT", discount: { type: "FLAT", value: 0 } }, keys())).toBe(b);
  });
});

describe("REFRESH_PRICES", () => {
  const base = () =>
    run([
      { type: "ADD_PRODUCT", product: P1 },
      { type: "ADD_PRODUCT", product: P2 },
    ]);

  it("updates only the listed lines", () => {
    const s = cartReducer(base(), { type: "REFRESH_PRICES", prices: { p1: 1800 } }, keys());
    expect(s.lines[0].unitPricePaise).toBe(1800);
    expect(s.lines[1].unitPricePaise).toBe(2500);
  });

  it("leaves lines whose product is missing from the map untouched, ignores unknown ids", () => {
    const s = cartReducer(base(), { type: "REFRESH_PRICES", prices: { p2: 2600, ghost: 1 } }, keys());
    expect(s.lines.map((l) => l.unitPricePaise)).toEqual([1500, 2600]);
    expect(s.lines).toHaveLength(2);
  });

  it("does not treat inherited object keys as listed products", () => {
    const odd = run([{ type: "ADD_PRODUCT", product: { id: "constructor", name: "X", pricePaise: 100 } }]);
    expect(cartReducer(odd, { type: "REFRESH_PRICES", prices: {} }, keys())).toBe(odd);
  });

  it("returns the same reference when nothing changed", () => {
    const b = base();
    expect(cartReducer(b, { type: "REFRESH_PRICES", prices: {} }, keys())).toBe(b);
    expect(cartReducer(b, { type: "REFRESH_PRICES", prices: { p1: 1500 } }, keys())).toBe(b);
    expect(cartReducer(b, { type: "REFRESH_PRICES", prices: { other: 5 } }, keys())).toBe(b);
  });

  it("preserves quantity, name and key", () => {
    const b = cartReducer(base(), { type: "SET_QUANTITY", productId: "p1", quantity: 4 }, keys());
    const s = cartReducer(b, { type: "REFRESH_PRICES", prices: { p1: 2000 } }, keys());
    expect(s.lines[0]).toEqual({ productId: "p1", name: "Tea", unitPricePaise: 2000, quantity: 4 });
    expect(s.idempotencyKey).toBe(b.idempotencyKey);
  });
});

describe("idempotency key", () => {
  it("is unchanged by every action except RESET", () => {
    const newKey = keys();
    let s = initialCart(newKey);
    const key = s.idempotencyKey;
    const actions: CartAction[] = [
      { type: "ADD_PRODUCT", product: P1 },
      { type: "ADD_PRODUCT", product: P2 },
      { type: "SET_QUANTITY", productId: "p1", quantity: 3 },
      { type: "SET_DISCOUNT", discount: { type: "FLAT", value: 100 } },
      { type: "REFRESH_PRICES", prices: { p1: 1700 } },
      { type: "REMOVE", productId: "p2" },
    ];
    for (const a of actions) {
      s = cartReducer(s, a, newKey);
      expect(s.idempotencyKey).toBe(key);
    }
  });

  it("RESET clears lines and discount and generates a new key", () => {
    const newKey = keys();
    let s = initialCart(newKey);
    s = cartReducer(s, { type: "ADD_PRODUCT", product: P1 }, newKey);
    s = cartReducer(s, { type: "SET_DISCOUNT", discount: { type: "FLAT", value: 100 } }, newKey);
    const old = s.idempotencyKey;
    s = cartReducer(s, { type: "RESET" }, newKey);
    expect(s.lines).toEqual([]);
    expect(s.discount).toBeNull();
    expect(s.idempotencyKey).not.toBe(old);
    expect(s.idempotencyKey).toBe("key-2");
  });
});

describe("selectTotals", () => {
  it("is null for an empty cart", () => {
    expect(selectTotals(initialCart(() => "k"), CFG)).toBeNull();
  });

  it("matches calculateTotals exactly (no GST)", () => {
    const s = run([
      { type: "ADD_PRODUCT", product: P1 },
      { type: "ADD_PRODUCT", product: P1 },
      { type: "ADD_PRODUCT", product: P2 },
      { type: "SET_DISCOUNT", discount: { type: "PERCENT", value: 1000 } },
    ]);
    const expected = calculateTotals({
      lines: [
        { unitPricePaise: 1500, quantity: 2 },
        { unitPricePaise: 2500, quantity: 1 },
      ],
      discount: { type: "PERCENT", value: 1000 },
      gst: { enabled: false, rateBp: 0, inclusive: false },
      roundToRupee: false,
    });
    expect(selectTotals(s, CFG)).toEqual(expected);
  });

  it("matches calculateTotals with exclusive GST and rounding", () => {
    const cfg = { gstEnabled: true, gstRateBp: 1800, gstInclusive: false, roundToRupee: true };
    const s = run([{ type: "ADD_PRODUCT", product: { id: "x", name: "X", pricePaise: 3333 } }]);
    const expected = calculateTotals({
      lines: [{ unitPricePaise: 3333, quantity: 1 }],
      discount: null,
      gst: { enabled: true, rateBp: 1800, inclusive: false },
      roundToRupee: true,
    });
    expect(selectTotals(s, cfg)).toEqual(expected);
  });

  it("matches calculateTotals with inclusive GST", () => {
    const cfg = { gstEnabled: true, gstRateBp: 500, gstInclusive: true, roundToRupee: false };
    const s = run([{ type: "ADD_PRODUCT", product: P1 }]);
    const expected = calculateTotals({
      lines: [{ unitPricePaise: 1500, quantity: 1 }],
      discount: null,
      gst: { enabled: true, rateBp: 500, inclusive: true },
      roundToRupee: false,
    });
    expect(selectTotals(s, cfg)).toEqual(expected);
  });

  it("is null when a flat discount exceeds the subtotal", () => {
    const s = run([
      { type: "ADD_PRODUCT", product: P1 },
      { type: "SET_DISCOUNT", discount: { type: "FLAT", value: 999999 } },
    ]);
    expect(selectTotals(s, CFG)).toBeNull();
  });

  it("is null for a 100% percent discount (total 0)", () => {
    const s = run([
      { type: "ADD_PRODUCT", product: P1 },
      { type: "SET_DISCOUNT", discount: { type: "PERCENT", value: 10000 } },
    ]);
    expect(selectTotals(s, CFG)).toBeNull();
  });

  it("is null for a percent discount above 100%", () => {
    const s = run([
      { type: "ADD_PRODUCT", product: P1 },
      { type: "SET_DISCOUNT", discount: { type: "PERCENT", value: 20000 } },
    ]);
    expect(selectTotals(s, CFG)).toBeNull();
  });

  it("is null (does not throw) for an invalid line", () => {
    const bad: CartState = {
      lines: [{ productId: "p1", name: "Tea", unitPricePaise: 1500, quantity: 0 }],
      discount: null,
      idempotencyKey: "k",
    };
    expect(selectTotals(bad, CFG)).toBeNull();
  });

  it("is null when the subtotal is too large", () => {
    const s = run([{ type: "ADD_PRODUCT", product: { id: "big", name: "Big", pricePaise: 2_000_000_000 } }]);
    expect(selectTotals(s, CFG)).toBeNull();
  });

  it("rethrows non-AppError errors", () => {
    const weird = { lines: [null], discount: null, idempotencyKey: "k" } as unknown as CartState;
    expect(() => selectTotals(weird, CFG)).toThrow(TypeError);
  });
});
