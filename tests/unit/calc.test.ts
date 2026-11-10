import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { calculateTotals, type CalcInput } from "@/modules/billing/calc";

const LINES = [
  { unitPricePaise: 1500, quantity: 2 },
  { unitPricePaise: 1500, quantity: 1 },
];

function input(over: Partial<CalcInput> = {}): CalcInput {
  return {
    lines: LINES,
    discount: null,
    gst: { enabled: false, rateBp: 0, inclusive: false },
    roundToRupee: false,
    ...over,
  };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return undefined;
}

describe("calculateTotals", () => {
  it("GST off, no discount", () => {
    expect(calculateTotals(input())).toEqual({
      subtotalPaise: 4500,
      discountPaise: 0,
      taxablePaise: 4500,
      cgstPaise: 0,
      sgstPaise: 0,
      taxPaise: 0,
      roundOffPaise: 0,
      totalPaise: 4500,
    });
  });

  it("PERCENT discount", () => {
    const t = calculateTotals(input({ discount: { type: "PERCENT", value: 1000 } }));
    expect(t.discountPaise).toBe(450);
    expect(t.totalPaise).toBe(4050);
  });

  it("FLAT discount", () => {
    const t = calculateTotals(input({ discount: { type: "FLAT", value: 500 } }));
    expect(t.discountPaise).toBe(500);
    expect(t.totalPaise).toBe(4000);
  });

  it("discount validation and non-positive totals", () => {
    expect(codeOf(() => calculateTotals(input({ discount: { type: "FLAT", value: 4501 } })))).toBe("VALIDATION");
    expect(codeOf(() => calculateTotals(input({ discount: { type: "FLAT", value: 4500 } })))).toBe("TOTAL_NOT_POSITIVE");
    expect(codeOf(() => calculateTotals(input({ discount: { type: "PERCENT", value: 10000 } })))).toBe("TOTAL_NOT_POSITIVE");
    expect(codeOf(() => calculateTotals(input({ discount: { type: "PERCENT", value: 0 } })))).toBe("VALIDATION");
    expect(codeOf(() => calculateTotals(input({ discount: { type: "PERCENT", value: 10001 } })))).toBe("VALIDATION");
  });

  it("GST exclusive 500bp", () => {
    const t = calculateTotals(input({ gst: { enabled: true, rateBp: 500, inclusive: false } }));
    expect(t).toMatchObject({ taxPaise: 225, cgstPaise: 112, sgstPaise: 113, taxablePaise: 4500, totalPaise: 4725 });
  });

  it("GST inclusive 500bp", () => {
    const t = calculateTotals(input({ gst: { enabled: true, rateBp: 500, inclusive: true } }));
    expect(t).toMatchObject({ taxPaise: 214, taxablePaise: 4286, cgstPaise: 107, sgstPaise: 107, totalPaise: 4500 });
  });

  it("FLAT discount then exclusive GST", () => {
    const t = calculateTotals(
      input({ discount: { type: "FLAT", value: 500 }, gst: { enabled: true, rateBp: 500, inclusive: false } }),
    );
    expect(t).toMatchObject({ taxPaise: 200, cgstPaise: 100, sgstPaise: 100, taxablePaise: 4000, totalPaise: 4200 });
  });

  it("round to rupee, GST off", () => {
    const up = calculateTotals(input({ lines: [{ unitPricePaise: 4150, quantity: 1 }], roundToRupee: true }));
    expect(up).toMatchObject({ subtotalPaise: 4150, roundOffPaise: 50, totalPaise: 4200 });
    const down = calculateTotals(input({ lines: [{ unitPricePaise: 4125, quantity: 1 }], roundToRupee: true }));
    expect(down).toMatchObject({ subtotalPaise: 4125, roundOffPaise: -25, totalPaise: 4100 });
  });

  it("round to rupee with exclusive GST", () => {
    const t = calculateTotals(
      input({ gst: { enabled: true, rateBp: 500, inclusive: false }, roundToRupee: true }),
    );
    expect(t).toMatchObject({ taxPaise: 225, roundOffPaise: -25, totalPaise: 4700 });
  });

  it("rejects a total that rounds down to zero", () => {
    expect(codeOf(() => calculateTotals(input({ lines: [{ unitPricePaise: 40, quantity: 1 }], roundToRupee: true })))).toBe(
      "TOTAL_NOT_POSITIVE",
    );
  });

  it("validates lines", () => {
    expect(codeOf(() => calculateTotals(input({ lines: [{ unitPricePaise: 100, quantity: 0 }] })))).toBe("VALIDATION");
    expect(codeOf(() => calculateTotals(input({ lines: [{ unitPricePaise: 100, quantity: 1000 }] })))).toBe("VALIDATION");
    expect(codeOf(() => calculateTotals(input({ lines: [{ unitPricePaise: 100, quantity: 1.5 }] })))).toBe("VALIDATION");
    expect(codeOf(() => calculateTotals(input({ lines: [{ unitPricePaise: -1, quantity: 1 }] })))).toBe("VALIDATION");
    expect(codeOf(() => calculateTotals(input({ lines: [{ unitPricePaise: 10.5, quantity: 1 }] })))).toBe("VALIDATION");
    expect(codeOf(() => calculateTotals(input({ lines: [] })))).toBe("VALIDATION");
  });

  it("caps the subtotal at 1_000_000_000 paise so every stored amount fits Postgres int4", () => {
    const atCap = calculateTotals(input({ lines: [{ unitPricePaise: 1_000_000_000, quantity: 1 }] }));
    expect(atCap.subtotalPaise).toBe(1_000_000_000);
    expect(atCap.totalPaise).toBe(1_000_000_000);
    expect(codeOf(() => calculateTotals(input({ lines: [{ unitPricePaise: 1_000_000_001, quantity: 1 }] })))).toBe(
      "VALIDATION",
    );
    expect(
      codeOf(() =>
        calculateTotals(
          input({
            lines: [
              { unitPricePaise: 999_999_999, quantity: 1 },
              { unitPricePaise: 2, quantity: 1 },
            ],
          }),
        ),
      ),
    ).toBe("VALIDATION");
  });

  it("at the cap with 100% exclusive GST and rounding, every amount stays within int4", () => {
    const INT4_MAX = 2_147_483_647;
    for (const subtotal of [1_000_000_000, 999_999_951]) {
      const t = calculateTotals(
        input({
          lines: [{ unitPricePaise: subtotal, quantity: 1 }],
          gst: { enabled: true, rateBp: 10000, inclusive: false },
          roundToRupee: true,
        }),
      );
      expect(t.taxPaise).toBe(subtotal);
      expect(t.totalPaise).toBeLessThanOrEqual(2_000_000_000 + 50);
      for (const v of Object.values(t)) expect(Math.abs(v)).toBeLessThanOrEqual(INT4_MAX);
    }
  });

  it("validates discount value and GST rate are integers", () => {
    expect(codeOf(() => calculateTotals(input({ discount: { type: "FLAT", value: 10.5 } })))).toBe("VALIDATION");
    expect(codeOf(() => calculateTotals(input({ discount: { type: "PERCENT", value: 100.5 } })))).toBe("VALIDATION");
    expect(
      codeOf(() => calculateTotals(input({ gst: { enabled: true, rateBp: 5.5, inclusive: false } }))),
    ).toBe("VALIDATION");
    expect(
      codeOf(() => calculateTotals(input({ gst: { enabled: true, rateBp: -1, inclusive: false } }))),
    ).toBe("VALIDATION");
  });

  it("keeps invariants over 500 deterministic pseudo-random inputs", () => {
    let seed = 20261110;
    const rand = () => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

    let ok = 0;
    for (let i = 0; i < 500; i++) {
      const lines = Array.from({ length: int(1, 5) }, () => ({
        unitPricePaise: int(0, 500000),
        quantity: int(1, 999),
      }));
      const dk = int(0, 2);
      const discount: CalcInput["discount"] =
        dk === 0 ? null : dk === 1 ? { type: "PERCENT", value: int(1, 9999) } : { type: "FLAT", value: int(1, 2000) };
      const inclusive = rand() < 0.5;
      const gst = { enabled: rand() < 0.7, rateBp: int(0, 2800), inclusive };
      const roundToRupee = rand() < 0.5;
      const subtotal = lines.reduce((s, l) => s + l.unitPricePaise * l.quantity, 0);

      let t;
      try {
        t = calculateTotals({ lines, discount, gst, roundToRupee });
      } catch (e) {
        // only legitimate rejections: flat discount above subtotal, or non-positive total
        expect(e).toBeInstanceOf(AppError);
        expect(["VALIDATION", "TOTAL_NOT_POSITIVE"]).toContain((e as AppError).code);
        continue;
      }
      ok++;
      for (const v of Object.values(t)) expect(Number.isInteger(v)).toBe(true);
      expect(t.subtotalPaise).toBe(subtotal);
      expect(t.cgstPaise + t.sgstPaise).toBe(t.taxPaise);
      const taxAdded = gst.enabled && !inclusive ? t.taxPaise : 0;
      expect(t.totalPaise).toBe(t.subtotalPaise - t.discountPaise + taxAdded + t.roundOffPaise);
      expect(t.totalPaise).toBeGreaterThan(0);
      if (roundToRupee) {
        expect(t.totalPaise % 100).toBe(0);
        expect(Math.abs(t.roundOffPaise)).toBeLessThanOrEqual(50);
      } else {
        expect(t.roundOffPaise).toBe(0);
      }
      if (!gst.enabled) expect(t.taxPaise).toBe(0);
    }
    expect(ok).toBeGreaterThan(400);
  });
});
