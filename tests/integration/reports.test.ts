import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { calculateTotals } from "@/modules/billing/calc";
import type { CreateBillInput } from "@/modules/billing/schema";
import { createBill } from "@/modules/billing/service";
import { cancelBill } from "@/modules/bills/service";
import { updateProduct } from "@/modules/catalog/service";
import { buildReportCsv } from "@/modules/reports/csv";
import {
  getBillsForCsv,
  getDailyBreakdown,
  getDashboard,
  getSalesSummary,
  getTopItems,
  rangeForPeriod,
  type DateRange,
} from "@/modules/reports/service";
import { updateSettings } from "@/modules/shop/service";
import { makeProduct, makeShop, resetDb, type TestShop } from "../helpers/db";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return "NO_ERROR";
}

interface P {
  productId: string;
  pricePaise: number;
}

interface BillOpts {
  method?: "CASH" | "UPI";
  discount?: CreateBillInput["discount"];
  gst?: { enabled: boolean; rateBp: number; inclusive: boolean };
}

/** A createBill input whose expected total is computed the way the cashier screen does. */
function input(lines: Array<[P, number]>, o: BillOpts = {}): CreateBillInput {
  const total = calculateTotals({
    lines: lines.map(([p, q]) => ({ unitPricePaise: p.pricePaise, quantity: q })),
    discount: o.discount ?? null,
    gst: o.gst ?? { enabled: false, rateBp: 500, inclusive: true },
    roundToRupee: false,
  }).totalPaise;
  return {
    idempotencyKey: randomUUID(),
    items: lines.map(([p, q]) => ({ productId: p.productId, quantity: q, expectedUnitPricePaise: p.pricePaise })),
    discount: o.discount ?? null,
    payment:
      (o.method ?? "CASH") === "CASH"
        ? { method: "CASH", cashTenderedPaise: total }
        : { method: "UPI", confirmed: true, reference: "UTR1" },
    expectedTotalPaise: total,
  };
}

// IST = UTC+5:30. All "now" values below are distinct.
const D09_NOON = new Date("2026-11-09T06:30:00Z"); // Mon 09 Nov 12:00 IST
const D09_PM = new Date("2026-11-09T10:30:00Z"); // 16:00 IST
const D10_NOON = new Date("2026-11-10T06:30:00Z"); // Tue 10 Nov 12:00 IST
const D10_1230 = new Date("2026-11-10T07:00:00Z"); // 12:30 IST
const D10_2330 = new Date("2026-11-10T18:00:00Z"); // 23:30 IST, still 10 Nov
const D12_NOON = new Date("2026-11-12T06:30:00Z"); // Thu 12 Nov 12:00 IST
const D12_LATE = new Date("2026-11-12T08:00:00Z"); // when the cancel happens

const GST5X = { enabled: true, rateBp: 500, inclusive: false };

describe("reports service", () => {
  let t: TestShop;
  let dosa: P;
  let coffee: P;
  let idli: P;
  let appam: P;

  /**
   * Fixture (hand computed). Dosa 60.00, Coffee 25.00, Idli 40.00, Appam 40.00.
   *  Mon 11-09  B1 cash  2 dosa + 1 coffee             = 145.00, total 145.00
   *             B2 upi   1 dosa + 2 coffee, flat 10.00 = 110.00 - 10.00 = total 100.00
   *  Tue 11-10  (GST 5% exclusive from here)
   *             B3 cash  1 dosa + 1 coffee = 85.00, 10% off = 8.50, net 76.50, GST 3.83, total 80.33
   *             B4 cash  1 dosa = 60.00, GST 3.00, total 63.00 -> CANCELLED later (still business date 11-10)
   *             B5 upi   1 idli + 1 appam (23:30 IST) = 80.00, GST 4.00, total 84.00
   *  Thu 11-12  B6 cash  3 coffee = 75.00, GST 3.75, total 78.75
   * Completed: gross 495.00, discount 18.50, GST 11.58, total 488.08, 5 bills,
   * cash 304.08 (14500+8033+7875), upi 184.00 (10000+8400), avg 97.62 (9761.6).
   */
  async function seed(): Promise<void> {
    const o = t.owner.ctx;
    await createBill(o, input([[dosa, 2], [coffee, 1]]), D09_NOON);
    await createBill(
      o,
      input([[dosa, 1], [coffee, 2]], { method: "UPI", discount: { type: "FLAT", value: 1000 } }),
      D09_PM,
    );
    await updateSettings(o, { gstEnabled: true, gstRateBp: 500, gstInclusive: false });
    await createBill(
      o,
      input([[dosa, 1], [coffee, 1]], { discount: { type: "PERCENT", value: 1000 }, gst: GST5X }),
      D10_NOON,
    );
    const cancelled = await createBill(o, input([[dosa, 1]], { gst: GST5X }), D10_1230);
    await createBill(o, input([[idli, 1], [appam, 1]], { method: "UPI", gst: GST5X }), D10_2330);
    await createBill(o, input([[coffee, 3]], { gst: GST5X }), D12_NOON);
    await cancelBill(o, cancelled.id, "Wrong order", D12_LATE);
  }

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
    const mk = async (name: string, pricePaise: number): Promise<P> => ({
      productId: await makeProduct(t.shopId, { name, pricePaise }),
      pricePaise,
    });
    dosa = await mk("Masala Dosa", 6000);
    coffee = await mk("Filter Coffee", 2500);
    idli = await mk("Idli", 4000);
    appam = await mk("Appam", 4000);
  });

  describe("rangeForPeriod", () => {
    it("day is the anchor itself", () => {
      expect(rangeForPeriod("day", "2026-11-10")).toEqual({ from: "2026-11-10", to: "2026-11-10" });
    });
    it("week runs Monday to Sunday", () => {
      expect(rangeForPeriod("week", "2026-11-10")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
      expect(rangeForPeriod("week", "2026-11-09")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
      expect(rangeForPeriod("week", "2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    });
    it("month covers the whole calendar month", () => {
      expect(rangeForPeriod("month", "2026-02-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
      expect(rangeForPeriod("month", "2028-02-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    });
    it("rejects a bad anchor or period with VALIDATION", () => {
      for (const bad of ["", "2026-13-01", "2026-02-30", "26-11-10", "2026-11-10T00:00", "abc"]) {
        expect(() => rangeForPeriod("day", bad)).toThrowError(expect.objectContaining({ code: "VALIDATION" }));
      }
      expect(() => rangeForPeriod("year" as "day", "2026-11-10")).toThrowError(
        expect.objectContaining({ code: "VALIDATION" }),
      );
    });
  });

  describe("getSalesSummary", () => {
    it("matches the hand-computed fixture; cancelled money is excluded and reported separately", async () => {
      await seed();
      const s = await getSalesSummary(t.owner.ctx, { from: "2026-11-09", to: "2026-11-15" });
      expect(s).toEqual({
        grossSalesPaise: 49500,
        discountPaise: 1850,
        gstPaise: 1158,
        totalPaise: 48808,
        billCount: 5,
        avgBillPaise: 9762,
        cashPaise: 30408,
        upiPaise: 18400,
        cancelledCount: 1,
        cancelledPaise: 6300,
      });
      expect(s.cashPaise + s.upiPaise).toBe(s.totalPaise);
      expect(s.grossSalesPaise - s.discountPaise + s.gstPaise).toBe(s.totalPaise);
    });

    it("attributes a cancelled bill to its own business date, not to the day it was cancelled", async () => {
      await seed(); // the cancelled bill is business date 11-10, cancelled on 11-12
      const early = await getSalesSummary(t.owner.ctx, { from: "2026-11-10", to: "2026-11-10" });
      expect(early.cancelledCount).toBe(1);
      expect(early.cancelledPaise).toBe(6300);
      expect(early.billCount).toBe(2);
      expect(early.totalPaise).toBe(16433);
      const late = await getSalesSummary(t.owner.ctx, { from: "2026-11-11", to: "2026-11-12" });
      expect(late.cancelledCount).toBe(0);
      expect(late.cancelledPaise).toBe(0);
      expect(late).toMatchObject({ billCount: 1, totalPaise: 7875, cashPaise: 7875, upiPaise: 0, gstPaise: 375 });
    });

    it("a bill at 23:30 IST counts on its own date", async () => {
      await seed();
      const d = await getSalesSummary(t.owner.ctx, { from: "2026-11-10", to: "2026-11-10" });
      expect(d.upiPaise).toBe(8400); // the 23:30 UPI bill
      const next = await getSalesSummary(t.owner.ctx, { from: "2026-11-11", to: "2026-11-11" });
      expect(next.billCount).toBe(0);
    });

    it("with dayStartHour 4, a 02:00 IST bill counts on the previous date", async () => {
      await updateSettings(t.owner.ctx, { dayStartHour: 4 });
      await createBill(t.owner.ctx, input([[dosa, 1]]), new Date("2026-11-10T20:30:00Z")); // 02:00 IST 11-11
      await createBill(t.owner.ctx, input([[coffee, 1]]), new Date("2026-11-10T22:30:00Z")); // 04:00 IST 11-11
      const prev = await getSalesSummary(t.owner.ctx, { from: "2026-11-10", to: "2026-11-10" });
      expect(prev).toMatchObject({ billCount: 1, totalPaise: 6000 });
      const next = await getSalesSummary(t.owner.ctx, { from: "2026-11-11", to: "2026-11-11" });
      expect(next).toMatchObject({ billCount: 1, totalPaise: 2500 });
    });

    it("counts GST whether prices were inclusive or exclusive", async () => {
      await updateSettings(t.owner.ctx, { gstEnabled: true, gstRateBp: 500, gstInclusive: true });
      // 60.00 inclusive of 5%: tax = 6000 - round(6000 * 10000 / 10500) = 6000 - 5714 = 286, total stays 60.00
      await createBill(
        t.owner.ctx,
        input([[dosa, 1]], { gst: { enabled: true, rateBp: 500, inclusive: true } }),
        D10_NOON,
      );
      const s = await getSalesSummary(t.owner.ctx, { from: "2026-11-10", to: "2026-11-10" });
      expect(s).toMatchObject({
        grossSalesPaise: 6000,
        gstPaise: 286,
        totalPaise: 6000,
        cashPaise: 6000,
        avgBillPaise: 6000,
      });
    });

    it("an empty range is all zeros, with no division by zero", async () => {
      expect(await getSalesSummary(t.owner.ctx, { from: "2026-11-01", to: "2026-11-30" })).toEqual({
        grossSalesPaise: 0,
        discountPaise: 0,
        gstPaise: 0,
        totalPaise: 0,
        billCount: 0,
        avgBillPaise: 0,
        cashPaise: 0,
        upiPaise: 0,
        cancelledCount: 0,
        cancelledPaise: 0,
      });
    });

    it("a range with only a cancelled bill has zero sales but reports the cancellation", async () => {
      const b = await createBill(t.owner.ctx, input([[dosa, 1]]), D10_NOON);
      await cancelBill(t.owner.ctx, b.id, "oops", D10_1230);
      const s = await getSalesSummary(t.owner.ctx, { from: "2026-11-10", to: "2026-11-10" });
      expect(s).toMatchObject({
        billCount: 0,
        totalPaise: 0,
        avgBillPaise: 0,
        cashPaise: 0,
        upiPaise: 0,
        cancelledCount: 1,
        cancelledPaise: 6000,
      });
    });

    it("sums past the int4 limit without overflow", async () => {
      const big: P = {
        productId: await makeProduct(t.shopId, { name: "Banquet", pricePaise: 1_000_000_000 }),
        pricePaise: 1_000_000_000,
      };
      for (let i = 0; i < 3; i++) {
        await createBill(
          t.owner.ctx,
          input([[big, 1]], { method: i === 0 ? "UPI" : "CASH" }),
          new Date(D10_NOON.getTime() + i * 60_000),
        );
      }
      const range = { from: "2026-11-10", to: "2026-11-10" };
      const s = await getSalesSummary(t.owner.ctx, range);
      expect(s).toMatchObject({
        grossSalesPaise: 3_000_000_000,
        totalPaise: 3_000_000_000,
        billCount: 3,
        avgBillPaise: 1_000_000_000,
        cashPaise: 2_000_000_000,
        upiPaise: 1_000_000_000,
      });
      const [row] = await getDailyBreakdown(t.owner.ctx, range);
      expect(row.totalPaise).toBe(3_000_000_000);
      const [top] = await getTopItems(t.owner.ctx, range);
      expect(top).toEqual({ productName: "Banquet", quantity: 3, amountPaise: 3_000_000_000 });
    });

    it("never counts another shop's bills", async () => {
      await seed();
      const other = await makeShop();
      const op: P = { productId: await makeProduct(other.shopId, { name: "Other Dosa", pricePaise: 7000 }), pricePaise: 7000 };
      await createBill(other.owner.ctx, input([[op, 1]]), D10_NOON);
      const cb = await createBill(other.owner.ctx, input([[op, 1]]), D10_1230);
      await cancelBill(other.owner.ctx, cb.id, "other shop cancel", D10_2330);
      const range: DateRange = { from: "2026-11-09", to: "2026-11-15" };
      const mine = await getSalesSummary(t.owner.ctx, range);
      expect(mine.totalPaise).toBe(48808);
      expect(mine.billCount).toBe(5);
      expect(mine.cancelledCount).toBe(1);
      expect((await getDailyBreakdown(t.owner.ctx, range)).reduce((n, r) => n + r.billCount, 0)).toBe(5);
      expect((await getTopItems(t.owner.ctx, range)).map((r) => r.productName)).not.toContain("Other Dosa");
      expect(await getBillsForCsv(t.owner.ctx, range)).toHaveLength(6);
      const theirs = await getSalesSummary(other.owner.ctx, range);
      expect(theirs).toMatchObject({ totalPaise: 7000, billCount: 1, cancelledCount: 1, cancelledPaise: 7000 });
    });
  });

  describe("getDailyBreakdown", () => {
    it("groups by business date, ascending, only dates with completed sales", async () => {
      await seed();
      const rows = await getDailyBreakdown(t.owner.ctx, { from: "2026-11-01", to: "2026-11-30" });
      expect(rows).toEqual([
        { businessDate: "2026-11-09", billCount: 2, totalPaise: 24500, cashPaise: 14500, upiPaise: 10000, discountPaise: 1000, gstPaise: 0 },
        { businessDate: "2026-11-10", billCount: 2, totalPaise: 16433, cashPaise: 8033, upiPaise: 8400, discountPaise: 850, gstPaise: 783 },
        { businessDate: "2026-11-12", billCount: 1, totalPaise: 7875, cashPaise: 7875, upiPaise: 0, discountPaise: 0, gstPaise: 375 },
      ]);
      expect(rows.reduce((n, r) => n + r.totalPaise, 0)).toBe(48808);
    });

    it("respects the range bounds (inclusive) and omits a date that has only cancelled bills", async () => {
      await seed();
      const b = await createBill(t.owner.ctx, input([[dosa, 1]], { gst: GST5X }), new Date("2026-11-13T06:30:00Z"));
      await cancelBill(t.owner.ctx, b.id, "oops", new Date("2026-11-13T07:00:00Z"));
      const rows = await getDailyBreakdown(t.owner.ctx, { from: "2026-11-10", to: "2026-11-13" });
      expect(rows.map((r) => r.businessDate)).toEqual(["2026-11-10", "2026-11-12"]);
    });

    it("is empty for an empty range", async () => {
      expect(await getDailyBreakdown(t.owner.ctx, { from: "2026-11-01", to: "2026-11-02" })).toEqual([]);
    });
  });

  describe("getTopItems", () => {
    it("orders by amount desc then name asc, from completed bills only", async () => {
      await seed();
      const rows = await getTopItems(t.owner.ctx, { from: "2026-11-09", to: "2026-11-15" });
      // Dosa: 2+1+1 = 4 (the cancelled bill is excluded) -> 24000; Coffee 1+2+1+3 = 7 -> 17500; Appam and Idli tie
      expect(rows).toEqual([
        { productName: "Masala Dosa", quantity: 4, amountPaise: 24000 },
        { productName: "Filter Coffee", quantity: 7, amountPaise: 17500 },
        { productName: "Appam", quantity: 1, amountPaise: 4000 },
        { productName: "Idli", quantity: 1, amountPaise: 4000 },
      ]);
    });

    it("applies the limit (default 10, clamped to 1..50)", async () => {
      await seed();
      const range = { from: "2026-11-09", to: "2026-11-15" };
      expect((await getTopItems(t.owner.ctx, range, 2)).map((r) => r.productName)).toEqual([
        "Masala Dosa",
        "Filter Coffee",
      ]);
      expect(await getTopItems(t.owner.ctx, range, 0)).toHaveLength(1);
      expect(await getTopItems(t.owner.ctx, range, -5)).toHaveLength(1);
      expect(await getTopItems(t.owner.ctx, range, 1000)).toHaveLength(4);
      expect(await getTopItems(t.owner.ctx, range)).toHaveLength(4);
    });

    it("groups by the name on the bill, so a renamed product keeps its history", async () => {
      await createBill(t.owner.ctx, input([[dosa, 1]]), D10_NOON);
      await updateProduct(t.owner.ctx, dosa.productId, { name: "Ghee Dosa" });
      await createBill(t.owner.ctx, input([[dosa, 1]]), D10_1230);
      const rows = await getTopItems(t.owner.ctx, { from: "2026-11-10", to: "2026-11-10" });
      expect(rows.map((r) => r.productName).sort()).toEqual(["Ghee Dosa", "Masala Dosa"]);
    });

    it("is empty for an empty range", async () => {
      expect(await getTopItems(t.owner.ctx, { from: "2026-11-01", to: "2026-11-02" })).toEqual([]);
    });
  });

  describe("getBillsForCsv", () => {
    it("returns one row per bill including cancelled, ordered by date then bill number, and feeds buildReportCsv", async () => {
      await seed();
      const range = { from: "2026-11-09", to: "2026-11-15" };
      const rows = await getBillsForCsv(t.owner.ctx, range);
      expect(rows).toEqual([
        { businessDate: "2026-11-09", billNumberDisplay: "B-2627-000001", tokenNumber: 1, status: "COMPLETED", subtotalPaise: 14500, discountPaise: 0, gstPaise: 0, totalPaise: 14500, paymentMethod: "CASH" },
        { businessDate: "2026-11-09", billNumberDisplay: "B-2627-000002", tokenNumber: 2, status: "COMPLETED", subtotalPaise: 11000, discountPaise: 1000, gstPaise: 0, totalPaise: 10000, paymentMethod: "UPI" },
        { businessDate: "2026-11-10", billNumberDisplay: "B-2627-000003", tokenNumber: 1, status: "COMPLETED", subtotalPaise: 8500, discountPaise: 850, gstPaise: 383, totalPaise: 8033, paymentMethod: "CASH" },
        { businessDate: "2026-11-10", billNumberDisplay: "B-2627-000004", tokenNumber: 2, status: "CANCELLED", subtotalPaise: 6000, discountPaise: 0, gstPaise: 300, totalPaise: 6300, paymentMethod: "CASH" },
        { businessDate: "2026-11-10", billNumberDisplay: "B-2627-000005", tokenNumber: 3, status: "COMPLETED", subtotalPaise: 8000, discountPaise: 0, gstPaise: 400, totalPaise: 8400, paymentMethod: "UPI" },
        { businessDate: "2026-11-12", billNumberDisplay: "B-2627-000006", tokenNumber: 1, status: "COMPLETED", subtotalPaise: 7500, discountPaise: 0, gstPaise: 375, totalPaise: 7875, paymentMethod: "CASH" },
      ]);
      const csv = buildReportCsv(rows, await getSalesSummary(t.owner.ctx, range));
      const lines = csv.split("\r\n");
      // header + 6 bills + blank + "Summary" + 10 summary rows + trailing empty after the last CRLF
      expect(lines).toHaveLength(1 + 6 + 1 + 1 + 10 + 1);
      expect(lines[4]).toBe("2026-11-10,B-2627-000004,2,CANCELLED,60.00,0.00,3.00,63.00,CASH");
      expect(csv).toContain("Net total,488.08\r\n");
    });

    it("is empty for an empty range", async () => {
      expect(await getBillsForCsv(t.owner.ctx, { from: "2026-11-01", to: "2026-11-02" })).toEqual([]);
    });
  });

  describe("getDashboard", () => {
    it("today is the shop's current business day and recent is the 10 newest bills, newest first", async () => {
      await seed();
      // 12 more bills on Fri 13 Nov, one a minute apart
      const base = new Date("2026-11-13T06:30:00Z");
      for (let i = 0; i < 12; i++) {
        await createBill(t.owner.ctx, input([[coffee, 1]], { gst: GST5X }), new Date(base.getTime() + i * 60_000));
      }
      const d = await getDashboard(t.owner.ctx, new Date("2026-11-13T07:00:00Z"));
      // 12 x (25.00 + 1.25 GST = 26.25)
      expect(d.today).toMatchObject({
        billCount: 12,
        totalPaise: 31500,
        grossSalesPaise: 30000,
        gstPaise: 1500,
        cashPaise: 31500,
        upiPaise: 0,
        cancelledCount: 0,
      });
      expect(d.recent).toHaveLength(10);
      expect(d.recent.every((r) => r.businessDate === "2026-11-13")).toBe(true);
      const times = d.recent.map((r) => r.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(d.recent[0].billNumberDisplay).toBe("B-2627-000018");
    });

    it("recent spans earlier days when today has few bills, and includes cancelled bills", async () => {
      await seed();
      const d = await getDashboard(t.owner.ctx, new Date("2026-11-13T07:00:00Z"));
      expect(d.today).toMatchObject({ billCount: 0, totalPaise: 0, avgBillPaise: 0 });
      expect(d.recent.map((r) => r.billNumberDisplay)).toEqual([
        "B-2627-000006",
        "B-2627-000005",
        "B-2627-000004",
        "B-2627-000003",
        "B-2627-000002",
        "B-2627-000001",
      ]);
      expect(d.recent[2].status).toBe("CANCELLED");
    });

    it("uses the day-start hour: at 02:00 IST with dayStartHour 4, today is still yesterday", async () => {
      await updateSettings(t.owner.ctx, { dayStartHour: 4 });
      await createBill(t.owner.ctx, input([[dosa, 1]]), new Date("2026-11-10T16:30:00Z")); // 22:00 IST 11-10
      const d = await getDashboard(t.owner.ctx, new Date("2026-11-10T20:30:00Z")); // 02:00 IST 11-11
      expect(d.today).toMatchObject({ billCount: 1, totalPaise: 6000 });
      const later = await getDashboard(t.owner.ctx, new Date("2026-11-10T22:30:00Z")); // 04:00 IST 11-11
      expect(later.today.billCount).toBe(0);
    });
  });

  describe("access and validation", () => {
    it("a cashier gets FORBIDDEN from every report function", async () => {
      await seed();
      const c = t.cashier.ctx;
      const range = { from: "2026-11-09", to: "2026-11-15" };
      expect(await code(getSalesSummary(c, range))).toBe("FORBIDDEN");
      expect(await code(getDailyBreakdown(c, range))).toBe("FORBIDDEN");
      expect(await code(getTopItems(c, range))).toBe("FORBIDDEN");
      expect(await code(getBillsForCsv(c, range))).toBe("FORBIDDEN");
      expect(await code(getDashboard(c, D10_NOON))).toBe("FORBIDDEN");
      // role is checked before the range: even an invalid range is FORBIDDEN, not VALIDATION
      expect(await code(getSalesSummary(c, { from: "bad", to: "bad" }))).toBe("FORBIDDEN");
    });

    it("rejects reversed, oversized and malformed ranges with VALIDATION", async () => {
      const o = t.owner.ctx;
      const bad: DateRange[] = [
        { from: "2026-11-10", to: "2026-11-09" },
        { from: "2024-01-01", to: "2025-01-01" }, // 367 days inclusive
        { from: "2026-01-01", to: "2028-01-01" },
        { from: "2026-02-30", to: "2026-03-01" },
        { from: "2026-13-01", to: "2026-13-02" },
        { from: "2026-11-1", to: "2026-11-10" },
        { from: "", to: "2026-11-10" },
        { from: "2026-11-01", to: "not a date" },
        { from: "2026-11-01'; DROP TABLE bills;--", to: "2026-11-10" },
        { from: undefined as unknown as string, to: "2026-11-10" },
      ];
      for (const r of bad) {
        expect(await code(getSalesSummary(o, r))).toBe("VALIDATION");
        expect(await code(getDailyBreakdown(o, r))).toBe("VALIDATION");
        expect(await code(getTopItems(o, r))).toBe("VALIDATION");
        expect(await code(getBillsForCsv(o, r))).toBe("VALIDATION");
      }
    });

    it("accepts a one-day range and a full 366-day range", async () => {
      const o = t.owner.ctx;
      expect(await code(getSalesSummary(o, { from: "2026-11-10", to: "2026-11-10" }))).toBe("NO_ERROR");
      expect(await code(getSalesSummary(o, { from: "2024-01-01", to: "2024-12-31" }))).toBe("NO_ERROR");
    });
  });
});
