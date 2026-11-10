import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditLogs, bills, numberSequences, payments } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { createBill } from "@/modules/billing/service";
import { cancelBill, getBill, listBills, recordPrint } from "@/modules/bills/service";
import { prepareReceiptPrint } from "@/modules/printing/service";
import { updateSettings } from "@/modules/shop/service";
import { cashBillInput, upiBillInput } from "../helpers/bills";
import { makeProduct, makeShop, resetDb, type TestShop } from "../helpers/db";

/** 12:00 IST on 2026-11-10 (business date 2026-11-10). */
const NOW = new Date("2026-11-10T06:30:00Z");
const YESTERDAY = new Date("2026-11-09T06:30:00Z");

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return "NO_ERROR";
}

async function sequences(shopId: string) {
  return db
    .select()
    .from(numberSequences)
    .where(eq(numberSequences.shopId, shopId))
    .orderBy(asc(numberSequences.key));
}

async function audits(shopId: string, action: string) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.shopId, shopId), eq(auditLogs.action, action)))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
}

describe("bills service", () => {
  let t: TestShop;
  let dosa: { productId: string; pricePaise: number };
  let coffee: { productId: string; pricePaise: number };

  const line = (p: { productId: string; pricePaise: number }, quantity = 1) => ({ ...p, quantity });

  beforeEach(async () => {
    await resetDb();
    t = await makeShop();
    dosa = { productId: await makeProduct(t.shopId, { name: "Masala Dosa", pricePaise: 6000 }), pricePaise: 6000 };
    coffee = { productId: await makeProduct(t.shopId, { name: "Filter Coffee", pricePaise: 2500 }), pricePaise: 2500 };
  });

  describe("listBills", () => {
    it("cashier never sees yesterday's bills, even when a date is passed", async () => {
      const old = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), YESTERDAY);
      const today = await createBill(t.owner.ctx, cashBillInput([line(coffee)]), NOW);

      const plain = await listBills(t.cashier.ctx, {}, NOW);
      expect(plain.rows.map((r) => r.id)).toEqual([today.id]);
      expect(plain.total).toBe(1);

      const asked = await listBills(t.cashier.ctx, { date: "2026-11-09" }, NOW);
      expect(asked.rows.map((r) => r.id)).toEqual([today.id]);
      const range = await listBills(t.cashier.ctx, { from: "2026-11-01", to: "2026-11-09" }, NOW);
      expect(range.rows.map((r) => r.id)).toEqual([today.id]);
      expect(asked.rows.some((r) => r.id === old.id)).toBe(false);
    });

    it("owner can filter by date, range, status and method; no filter returns all", async () => {
      const old = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), YESTERDAY);
      const cashToday = await createBill(t.owner.ctx, cashBillInput([line(coffee)]), NOW);
      const upiToday = await createBill(t.owner.ctx, upiBillInput([line(coffee, 2)]), NOW);
      await cancelBill(t.owner.ctx, upiToday.id, "wrong order", NOW);

      const all = await listBills(t.owner.ctx, {}, NOW);
      expect(all.total).toBe(3);
      // newest first
      expect(all.rows.map((r) => r.id)).toEqual([upiToday.id, cashToday.id, old.id]);

      const byDate = await listBills(t.owner.ctx, { date: "2026-11-09" }, NOW);
      expect(byDate.rows.map((r) => r.id)).toEqual([old.id]);

      const range = await listBills(t.owner.ctx, { from: "2026-11-09", to: "2026-11-10" }, NOW);
      expect(range.total).toBe(3);
      const fromOnly = await listBills(t.owner.ctx, { from: "2026-11-10" }, NOW);
      expect(fromOnly.total).toBe(2);
      const toOnly = await listBills(t.owner.ctx, { to: "2026-11-09" }, NOW);
      expect(toOnly.rows.map((r) => r.id)).toEqual([old.id]);

      const cancelled = await listBills(t.owner.ctx, { status: "CANCELLED" }, NOW);
      expect(cancelled.rows.map((r) => r.id)).toEqual([upiToday.id]);
      expect(cancelled.rows[0].status).toBe("CANCELLED");
      const upi = await listBills(t.owner.ctx, { method: "UPI" }, NOW);
      expect(upi.rows.map((r) => r.id)).toEqual([upiToday.id]);
      expect(upi.rows[0].paymentMethod).toBe("UPI");
      expect(upi.rows[0].totalPaise).toBe(5000);
      const cash = await listBills(t.owner.ctx, { method: "CASH", status: "COMPLETED" }, NOW);
      expect(cash.rows.map((r) => r.id)).toEqual([cashToday.id, old.id]);
    });

    it("search: digits match the token or the bill number exactly, otherwise ILIKE on the display number", async () => {
      const b1 = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      const b2 = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      const b3 = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      expect([b1.tokenNumber, b2.tokenNumber, b3.tokenNumber]).toEqual([1, 2, 3]);

      const tok = await listBills(t.owner.ctx, { search: "3" }, NOW);
      expect(tok.rows.map((r) => r.id)).toEqual([b3.id]);
      const tokSpaced = await listBills(t.cashier.ctx, { search: " 3 " }, NOW);
      expect(tokSpaced.rows.map((r) => r.id)).toEqual([b3.id]);

      const num = await listBills(t.owner.ctx, { search: "000002" }, NOW);
      expect(num.rows.map((r) => r.id)).toEqual([b2.id]);

      const display = await listBills(t.owner.ctx, { search: "b-2627-000001" }, NOW);
      expect(display.rows.map((r) => r.id)).toEqual([b1.id]);
      // all digits are never a substring match: "2627" is neither a token nor a bill number here
      expect((await listBills(t.owner.ctx, { search: "2627" }, NOW)).total).toBe(0);
      expect((await listBills(t.owner.ctx, { search: "zzz" }, NOW)).total).toBe(0);
    });

    it("search treats LIKE wildcards literally and token search stays within the date filter", async () => {
      const old = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), YESTERDAY); // token 1 on 11-09
      const today = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW); // token 1 on 11-10

      expect((await listBills(t.owner.ctx, { search: "%" }, NOW)).total).toBe(0);
      expect((await listBills(t.owner.ctx, { search: "B_2627" }, NOW)).total).toBe(0);
      expect((await listBills(t.owner.ctx, { search: "B-2627" }, NOW)).total).toBe(2);

      const cashier = await listBills(t.cashier.ctx, { search: "1" }, NOW);
      expect(cashier.rows.map((r) => r.id)).toEqual([today.id]);
      const ownerDay = await listBills(t.owner.ctx, { search: "1", date: "2026-11-09" }, NOW);
      expect(ownerDay.rows.map((r) => r.id)).toEqual([old.id]);
    });

    it("paginates with a total over the whole filter", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const at = new Date(NOW.getTime() + i * 60_000); // distinct created_at so the order is defined
        ids.push((await createBill(t.owner.ctx, cashBillInput([line(dosa)]), at)).id);
      }
      const p1 = await listBills(t.owner.ctx, { page: 1, pageSize: 2 }, NOW);
      const p3 = await listBills(t.owner.ctx, { page: 3, pageSize: 2 }, NOW);
      const p9 = await listBills(t.owner.ctx, { page: 9, pageSize: 2 }, NOW);
      expect(p1.total).toBe(5);
      expect(p1.rows.map((r) => r.id)).toEqual([ids[4], ids[3]]);
      expect(p3.rows.map((r) => r.id)).toEqual([ids[0]]);
      expect(p9.rows).toEqual([]);
      expect(p9.total).toBe(5);
    });

    it("rejects bad queries, hides other shops, and returns the documented row shape", async () => {
      const other = await makeShop();
      const mine = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);

      expect(await code(listBills(t.owner.ctx, { date: "10-11-2026" }, NOW))).toBe("VALIDATION");
      expect(await code(listBills(t.owner.ctx, { from: "2026-11-10x" }, NOW))).toBe("VALIDATION");
      expect(await code(listBills(t.owner.ctx, { search: "x".repeat(41) }, NOW))).toBe("VALIDATION");
      expect(await code(listBills(t.owner.ctx, { page: 0 }, NOW))).toBe("VALIDATION");
      expect(await code(listBills(t.owner.ctx, { pageSize: 101 }, NOW))).toBe("VALIDATION");
      expect(await code(listBills(t.owner.ctx, { status: "OPEN" as never }, NOW))).toBe("VALIDATION");
      expect(await code(listBills(t.owner.ctx, { bogus: 1 } as never, NOW))).toBe("VALIDATION");

      expect((await listBills(other.owner.ctx, {}, NOW)).total).toBe(0);
      const mineList = await listBills(t.owner.ctx, {}, NOW);
      expect(mineList.rows).toEqual([
        {
          id: mine.id,
          billNumberDisplay: "B-2627-000001",
          tokenNumber: 1,
          businessDate: "2026-11-10",
          createdAt: NOW,
          status: "COMPLETED",
          totalPaise: 6000,
          paymentMethod: "CASH",
        },
      ]);
    });

    it("cashier's today follows the shop's day start hour", async () => {
      await updateSettings(t.owner.ctx, { dayStartHour: 4 }, NOW);
      // 02:00 IST on 11-11 still belongs to business date 11-10
      const lateNight = new Date("2026-11-10T20:30:00Z");
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), lateNight);
      expect(b.businessDate).toBe("2026-11-10");
      expect((await listBills(t.cashier.ctx, {}, lateNight)).rows.map((r) => r.id)).toEqual([b.id]);
      const nextMorning = new Date("2026-11-10T23:30:00Z"); // 05:00 IST 11-11 => business date 11-11
      expect((await listBills(t.cashier.ctx, {}, nextMorning)).total).toBe(0);
    });
  });

  describe("getBill", () => {
    it("owner reads any day; cashier only today's business date", async () => {
      const old = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), YESTERDAY);
      const today = await createBill(t.owner.ctx, cashBillInput([line(coffee)]), NOW);

      expect((await getBill(t.owner.ctx, old.id, NOW)).id).toBe(old.id);
      expect(await code(getBill(t.cashier.ctx, old.id, NOW))).toBe("NOT_FOUND");
      expect(await getBill(t.cashier.ctx, today.id, NOW)).toEqual(today);
    });

    it("another shop's bill and malformed ids are NOT_FOUND", async () => {
      const other = await makeShop();
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      expect(await code(getBill(other.owner.ctx, b.id, NOW))).toBe("NOT_FOUND");
      expect(await code(getBill(other.cashier.ctx, b.id, NOW))).toBe("NOT_FOUND");
      expect(await code(getBill(t.owner.ctx, "not-a-uuid", NOW))).toBe("NOT_FOUND");
      expect(await code(getBill(t.owner.ctx, "00000000-0000-4000-8000-000000000000", NOW))).toBe("NOT_FOUND");
    });
  });

  describe("cancelBill", () => {
    it("owner cancels: bill CANCELLED, payment VOIDED, still listed and retrievable, audited with the reason", async () => {
      const b = await createBill(t.cashier.ctx, cashBillInput([line(dosa)]), YESTERDAY);
      const later = new Date("2026-11-10T08:00:00Z");
      const cancelled = await cancelBill(t.owner.ctx, b.id, "  customer left  ", later);
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.cancelReason).toBe("customer left");
      expect(cancelled.cancelledAt).toEqual(later);
      expect(cancelled.payment.status).toBe("VOIDED");
      expect(cancelled.billNumberDisplay).toBe(b.billNumberDisplay);
      expect(cancelled.tokenNumber).toBe(b.tokenNumber);

      const [row] = await db.select().from(bills).where(eq(bills.id, b.id));
      expect(row.cancelledBy).toBe(t.owner.id);
      const [pay] = await db.select().from(payments).where(eq(payments.billId, b.id));
      expect(pay.status).toBe("VOIDED");

      const listed = await listBills(t.owner.ctx, { status: "CANCELLED" }, NOW);
      expect(listed.rows.map((r) => r.id)).toEqual([b.id]);
      expect((await getBill(t.owner.ctx, b.id, NOW)).status).toBe("CANCELLED");

      const [audit] = await audits(t.shopId, "BILL_CANCELLED");
      expect(audit.userId).toBe(t.owner.id);
      expect(audit.entityType).toBe("bill");
      expect(audit.entityId).toBe(b.id);
      expect(audit.meta).toEqual({ reason: "customer left" });
    });

    it("rejects an empty, short or too long reason with VALIDATION and changes nothing", async () => {
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      expect(await code(cancelBill(t.owner.ctx, b.id, "", NOW))).toBe("VALIDATION");
      expect(await code(cancelBill(t.owner.ctx, b.id, "ab", NOW))).toBe("VALIDATION");
      expect(await code(cancelBill(t.owner.ctx, b.id, "  ab  ", NOW))).toBe("VALIDATION");
      expect(await code(cancelBill(t.owner.ctx, b.id, "x".repeat(201), NOW))).toBe("VALIDATION");
      expect((await getBill(t.owner.ctx, b.id, NOW)).status).toBe("COMPLETED");
      expect(await audits(t.shopId, "BILL_CANCELLED")).toHaveLength(0);
      // the upper boundary is accepted
      expect((await cancelBill(t.owner.ctx, b.id, "x".repeat(200), NOW)).status).toBe("CANCELLED");
    });

    it("a second cancel is ALREADY_CANCELLED and writes no second audit row", async () => {
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      await cancelBill(t.owner.ctx, b.id, "duplicate order", NOW);
      expect(await code(cancelBill(t.owner.ctx, b.id, "duplicate order", NOW))).toBe("ALREADY_CANCELLED");
      expect(await audits(t.shopId, "BILL_CANCELLED")).toHaveLength(1);
    });

    it("concurrent cancels: exactly one wins", async () => {
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      const results = await Promise.all(
        [1, 2, 3].map((i) => code(cancelBill(t.owner.ctx, b.id, `reason ${i}`, NOW))),
      );
      expect(results.filter((r) => r === "NO_ERROR")).toHaveLength(1);
      expect(results.filter((r) => r === "ALREADY_CANCELLED")).toHaveLength(2);
      expect(await audits(t.shopId, "BILL_CANCELLED")).toHaveLength(1);
    });

    it("cashier with the setting off is FORBIDDEN (also on a cancelled bill)", async () => {
      const b = await createBill(t.cashier.ctx, cashBillInput([line(dosa)]), NOW);
      expect(await code(cancelBill(t.cashier.ctx, b.id, "customer left", NOW))).toBe("FORBIDDEN");
      await cancelBill(t.owner.ctx, b.id, "customer left", NOW);
      expect(await code(cancelBill(t.cashier.ctx, b.id, "customer left", NOW))).toBe("FORBIDDEN");
      expect(await code(cancelBill(t.cashier.ctx, "nope", "customer left", NOW))).toBe("FORBIDDEN");
    });

    it("cashier with the setting on: same day succeeds, yesterday's bill is CANCEL_NOT_ALLOWED", async () => {
      await updateSettings(t.owner.ctx, { cashierCanCancel: true }, NOW);
      const old = await createBill(t.cashier.ctx, cashBillInput([line(dosa)]), YESTERDAY);
      const today = await createBill(t.cashier.ctx, cashBillInput([line(coffee)]), NOW);

      expect(await code(cancelBill(t.cashier.ctx, old.id, "customer left", NOW))).toBe("CANCEL_NOT_ALLOWED");
      expect((await getBill(t.owner.ctx, old.id, NOW)).status).toBe("COMPLETED");

      const done = await cancelBill(t.cashier.ctx, today.id, "customer left", NOW);
      expect(done.status).toBe("CANCELLED");
      const [row] = await db.select().from(bills).where(eq(bills.id, today.id));
      expect(row.cancelledBy).toBe(t.cashier.id);
      expect(await code(cancelBill(t.cashier.ctx, today.id, "customer left", NOW))).toBe("ALREADY_CANCELLED");

      // the owner can still cancel the old one
      expect((await cancelBill(t.owner.ctx, old.id, "customer left", NOW)).status).toBe("CANCELLED");
    });

    it("another shop's bill is NOT_FOUND and stays untouched", async () => {
      const other = await makeShop();
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      expect(await code(cancelBill(other.owner.ctx, b.id, "customer left", NOW))).toBe("NOT_FOUND");
      expect(await code(cancelBill(t.owner.ctx, "not-a-uuid", "customer left", NOW))).toBe("NOT_FOUND");
      expect((await getBill(t.owner.ctx, b.id, NOW)).status).toBe("COMPLETED");
    });

    it("never touches number_sequences, bill numbers or tokens; the next bill continues the series", async () => {
      const b1 = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      const b2 = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      const before = await sequences(t.shopId);
      expect(before.length).toBeGreaterThan(0);

      await cancelBill(t.owner.ctx, b2.id, "entered twice", NOW);
      await recordPrint(t.owner.ctx, b1.id, NOW);
      await recordPrint(t.owner.ctx, b1.id, NOW);
      await prepareReceiptPrint(t.owner.ctx, b2.id, NOW);
      expect(await sequences(t.shopId)).toEqual(before);

      const after = await getBill(t.owner.ctx, b2.id, NOW);
      expect(after.billNumber).toBe(b2.billNumber);
      expect(after.tokenNumber).toBe(b2.tokenNumber);
      const b3 = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      expect(b3.billNumber).toBe(3);
      expect(b3.tokenNumber).toBe(3);
    });
  });

  describe("recordPrint", () => {
    it("first print is not a reprint (BILL_PRINTED), the second is (BILL_REPRINTED)", async () => {
      const b = await createBill(t.cashier.ctx, cashBillInput([line(dosa)]), NOW);

      const first = await recordPrint(t.cashier.ctx, b.id, NOW);
      expect(first).toEqual({ isReprint: false, printCount: 1 });
      expect(await audits(t.shopId, "BILL_PRINTED")).toHaveLength(1);
      expect(await audits(t.shopId, "BILL_REPRINTED")).toHaveLength(0);

      const later = new Date("2026-11-10T07:00:00Z");
      const second = await recordPrint(t.cashier.ctx, b.id, later);
      expect(second).toEqual({ isReprint: true, printCount: 2 });
      const [printed] = await audits(t.shopId, "BILL_PRINTED");
      const [reprinted] = await audits(t.shopId, "BILL_REPRINTED");
      expect(printed.entityId).toBe(b.id);
      expect(printed.meta).toEqual({ printCount: 1 });
      expect(reprinted.entityId).toBe(b.id);
      expect(reprinted.userId).toBe(t.cashier.id);
      expect(reprinted.meta).toEqual({ printCount: 2 });

      const [row] = await db.select().from(bills).where(eq(bills.id, b.id));
      expect(row.printCount).toBe(2);
      expect(row.lastPrintedAt).toEqual(later);
      expect((await getBill(t.owner.ctx, b.id, NOW)).printCount).toBe(2);
    });

    it("works for cancelled bills", async () => {
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      await cancelBill(t.owner.ctx, b.id, "customer left", NOW);
      expect(await recordPrint(t.owner.ctx, b.id, NOW)).toEqual({ isReprint: false, printCount: 1 });
    });

    it("cashier: yesterday's and other shops' bills are NOT_FOUND and nothing is recorded", async () => {
      const other = await makeShop();
      const old = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), YESTERDAY);
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      expect(await code(recordPrint(t.cashier.ctx, old.id, NOW))).toBe("NOT_FOUND");
      expect(await code(recordPrint(other.owner.ctx, b.id, NOW))).toBe("NOT_FOUND");
      expect(await code(recordPrint(t.owner.ctx, "not-a-uuid", NOW))).toBe("NOT_FOUND");
      expect(await audits(t.shopId, "BILL_PRINTED")).toHaveLength(0);
      // the owner may print an old bill
      expect(await recordPrint(t.owner.ctx, old.id, NOW)).toEqual({ isReprint: false, printCount: 1 });
    });

    it("two concurrent first prints yield counts 1 and 2 and exactly one BILL_PRINTED", async () => {
      const b = await createBill(t.cashier.ctx, cashBillInput([line(dosa)]), NOW);
      const [a, c] = await Promise.all([
        recordPrint(t.cashier.ctx, b.id, NOW),
        recordPrint(t.cashier.ctx, b.id, NOW),
      ]);
      expect([a.printCount, c.printCount].sort()).toEqual([1, 2]);
      expect([a, c].filter((r) => !r.isReprint)).toHaveLength(1);
      expect(await audits(t.shopId, "BILL_PRINTED")).toHaveLength(1);
      expect(await audits(t.shopId, "BILL_REPRINTED")).toHaveLength(1);
    });
  });

  describe("prepareReceiptPrint", () => {
    it("the first receipt is not marked REPRINT, later ones are", async () => {
      const b = await createBill(t.cashier.ctx, cashBillInput([line(dosa)]), NOW);
      const first = await prepareReceiptPrint(t.cashier.ctx, b.id, NOW);
      expect(first.isReprint).toBe(false);
      expect(first.html).toContain(b.billNumberDisplay);
      expect(first.html).not.toContain("REPRINT");

      const second = await prepareReceiptPrint(t.cashier.ctx, b.id, NOW);
      expect(second.isReprint).toBe(true);
      expect(second.html).toContain("REPRINT");
      expect((await getBill(t.owner.ctx, b.id, NOW)).printCount).toBe(2);
    });

    it("a cancelled bill's receipt says CANCELLED", async () => {
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      await cancelBill(t.owner.ctx, b.id, "customer left", NOW);
      const r = await prepareReceiptPrint(t.owner.ctx, b.id, NOW);
      expect(r.html).toContain("CANCELLED");
      expect(r.html).not.toContain("REPRINT");
    });

    it("uses the shop's receipt header, footer and paper width", async () => {
      await updateSettings(
        t.owner.ctx,
        { receiptHeader: "HEADER-LINE-XYZ", receiptFooter: "FOOTER-LINE-XYZ", paperWidth: 58 },
        NOW,
      );
      const b = await createBill(t.cashier.ctx, cashBillInput([line(dosa)]), NOW);
      const r = await prepareReceiptPrint(t.cashier.ctx, b.id, NOW);
      expect(r.html).toContain("HEADER-LINE-XYZ");
      expect(r.html).toContain("FOOTER-LINE-XYZ");
      expect(r.html).toContain("size: 58mm");
    });

    it("an unreadable bill records no print", async () => {
      const other = await makeShop();
      const b = await createBill(t.owner.ctx, cashBillInput([line(dosa)]), NOW);
      expect(await code(prepareReceiptPrint(other.owner.ctx, b.id, NOW))).toBe("NOT_FOUND");
      expect(await audits(t.shopId, "BILL_PRINTED")).toHaveLength(0);
      expect((await getBill(t.owner.ctx, b.id, NOW)).printCount).toBe(0);
    });
  });
});
