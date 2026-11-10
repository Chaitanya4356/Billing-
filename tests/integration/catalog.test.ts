import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, categories, products } from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  createCategory,
  createProduct,
  deleteProduct,
  listCategories,
  listProducts,
  setCategoryActive,
  setProductActive,
  updateCategory,
  updateProduct,
} from "@/modules/catalog/service";
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

async function audit(shopId: string, action?: string) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.shopId, shopId))
    .orderBy(asc(auditLogs.createdAt));
  return action ? rows.filter((r) => r.action === action) : rows;
}

describe("catalog service", () => {
  let a: TestShop;
  let b: TestShop;

  beforeEach(async () => {
    await resetDb();
    a = await makeShop();
    // makeShop reuses the same usernames; they are unique per shop.
    b = await makeShop();
  });

  describe("tenant isolation and roles", () => {
    it("shop B gets NOT_FOUND updating shop A's product and sees none of its products", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      expect(await code(updateProduct(b.owner.ctx, id, { name: "Hacked" }))).toBe("NOT_FOUND");
      expect(await code(setProductActive(b.owner.ctx, id, false))).toBe("NOT_FOUND");
      expect(await code(deleteProduct(b.owner.ctx, id))).toBe("NOT_FOUND");
      expect(await listProducts(b.owner.ctx)).toEqual([]);
      expect(await listProducts(b.owner.ctx, { includeInactive: true })).toEqual([]);
      const [row] = await db.select().from(products).where(eq(products.id, id));
      expect(row.name).toBe("Samosa");
      expect(row.isActive).toBe(true);
      expect(row.deletedAt).toBeNull();
    });

    it("shop B cannot touch shop A's category or put a product into it", async () => {
      expect(await code(updateCategory(b.owner.ctx, a.categoryId, { name: "X" }))).toBe("NOT_FOUND");
      expect(await code(setCategoryActive(b.owner.ctx, a.categoryId, false))).toBe("NOT_FOUND");
      expect(
        await code(createProduct(b.owner.ctx, { name: "Tea", categoryId: a.categoryId, pricePaise: 100 })),
      ).toBe("NOT_FOUND");
      const id = await makeProduct(b.shopId, { name: "Tea", pricePaise: 100 });
      expect(await code(updateProduct(b.owner.ctx, id, { categoryId: a.categoryId }))).toBe("NOT_FOUND");
      const [cat] = await db.select().from(categories).where(eq(categories.id, a.categoryId));
      expect(cat.name).toBe("General");
      expect(cat.isActive).toBe(true);
    });

    it("a nonexistent or malformed id is NOT_FOUND", async () => {
      expect(await code(updateProduct(a.owner.ctx, "00000000-0000-4000-8000-000000000000", { name: "X" }))).toBe(
        "NOT_FOUND",
      );
      expect(await code(updateProduct(a.owner.ctx, "not-a-uuid", { name: "X" }))).toBe("NOT_FOUND");
      expect(await code(updateCategory(a.owner.ctx, "not-a-uuid", { name: "X" }))).toBe("NOT_FOUND");
    });

    it("cashier can list (active only by default) but cannot create or change anything", async () => {
      await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      const off = await makeProduct(a.shopId, { name: "Vada", pricePaise: 1000, isActive: false });
      const list = await listProducts(a.cashier.ctx);
      expect(list.map((p) => p.name)).toEqual(["Samosa"]);
      expect((await listCategories(a.cashier.ctx)).map((c) => c.name)).toEqual(["General"]);

      expect(
        await code(createProduct(a.cashier.ctx, { name: "Tea", categoryId: a.categoryId, pricePaise: 100 })),
      ).toBe("FORBIDDEN");
      expect(await code(updateProduct(a.cashier.ctx, off, { name: "Z" }))).toBe("FORBIDDEN");
      expect(await code(setProductActive(a.cashier.ctx, off, true))).toBe("FORBIDDEN");
      expect(await code(deleteProduct(a.cashier.ctx, off))).toBe("FORBIDDEN");
      expect(await code(createCategory(a.cashier.ctx, { name: "Snacks" }))).toBe("FORBIDDEN");
      expect(await code(updateCategory(a.cashier.ctx, a.categoryId, { name: "Z" }))).toBe("FORBIDDEN");
      expect(await code(setCategoryActive(a.cashier.ctx, a.categoryId, false))).toBe("FORBIDDEN");
      expect(await audit(a.shopId)).toHaveLength(0);
    });
  });

  describe("listing", () => {
    it("setProductActive(false) hides it from the default list and shows with includeInactive", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      await setProductActive(a.owner.ctx, id, false);
      expect(await listProducts(a.owner.ctx)).toEqual([]);
      const all = await listProducts(a.owner.ctx, { includeInactive: true });
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ id, name: "Samosa", isActive: false });
      await setProductActive(a.owner.ctx, id, true);
      expect(await listProducts(a.owner.ctx)).toHaveLength(1);
    });

    it("soft-deleted products are never listed, even with includeInactive", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      await makeProduct(a.shopId, { name: "Vada", pricePaise: 1000 });
      await deleteProduct(a.owner.ctx, id);
      expect((await listProducts(a.owner.ctx)).map((p) => p.name)).toEqual(["Vada"]);
      expect((await listProducts(a.owner.ctx, { includeInactive: true })).map((p) => p.name)).toEqual(["Vada"]);
      expect((await listProducts(a.owner.ctx, { search: "samosa", includeInactive: true }))).toEqual([]);
      // the row is kept, with a deleted_at
      const [row] = await db.select().from(products).where(eq(products.id, id));
      expect(row.deletedAt).not.toBeNull();
    });

    it("deleting twice, or updating a deleted product, is NOT_FOUND", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      await deleteProduct(a.owner.ctx, id);
      expect(await code(deleteProduct(a.owner.ctx, id))).toBe("NOT_FOUND");
      expect(await code(updateProduct(a.owner.ctx, id, { name: "Back" }))).toBe("NOT_FOUND");
      expect(await code(setProductActive(a.owner.ctx, id, true))).toBe("NOT_FOUND");
    });

    it("orders by sort_order then name, and filters by category", async () => {
      const snacks = await createCategory(a.owner.ctx, { name: "Snacks", sortOrder: 5 });
      await createProduct(a.owner.ctx, { name: "Zebra", categoryId: a.categoryId, pricePaise: 100, sortOrder: 1 });
      await createProduct(a.owner.ctx, { name: "Apple", categoryId: a.categoryId, pricePaise: 100, sortOrder: 2 });
      await createProduct(a.owner.ctx, { name: "Banana", categoryId: a.categoryId, pricePaise: 100, sortOrder: 2 });
      await createProduct(a.owner.ctx, { name: "Chips", categoryId: snacks.id, pricePaise: 100 });
      expect((await listProducts(a.owner.ctx)).map((p) => p.name)).toEqual(["Chips", "Zebra", "Apple", "Banana"]);
      expect((await listProducts(a.owner.ctx, { categoryId: a.categoryId })).map((p) => p.name)).toEqual([
        "Zebra",
        "Apple",
        "Banana",
      ]);
      expect((await listCategories(a.owner.ctx)).map((c) => c.name)).toEqual(["General", "Snacks"]);
    });

    it("listCategories hides inactive categories unless includeInactive", async () => {
      const c = await createCategory(a.owner.ctx, { name: "Old" });
      await setCategoryActive(a.owner.ctx, c.id, false);
      expect((await listCategories(a.owner.ctx)).map((x) => x.name)).toEqual(["General"]);
      expect((await listCategories(a.owner.ctx, { includeInactive: true })).map((x) => x.name)).toEqual([
        "General",
        "Old",
      ]);
      expect((await listCategories(b.owner.ctx, { includeInactive: true })).map((x) => x.name)).toEqual([
        "General",
      ]);
    });

    describe("search", () => {
      beforeEach(async () => {
        await createProduct(a.owner.ctx, { name: "Masala Tea", categoryId: a.categoryId, pricePaise: 1500, shortCode: "MT" });
        await createProduct(a.owner.ctx, { name: "Green TEA", categoryId: a.categoryId, pricePaise: 2000, shortCode: "gt1" });
        await createProduct(a.owner.ctx, { name: "Coffee", categoryId: a.categoryId, pricePaise: 2500 });
        await createProduct(a.owner.ctx, { name: "50% Off Combo", categoryId: a.categoryId, pricePaise: 100 });
        await createProduct(a.owner.ctx, { name: "Under_score", categoryId: a.categoryId, pricePaise: 100 });
      });

      const names = async (search: string) =>
        (await listProducts(a.owner.ctx, { search })).map((p) => p.name).sort();

      it("matches name as a case-insensitive substring", async () => {
        expect(await names("tea")).toEqual(["Green TEA", "Masala Tea"]);
        expect(await names("ASAL")).toEqual(["Masala Tea"]);
        expect(await names("  tea  ")).toEqual(["Green TEA", "Masala Tea"]);
      });

      it("matches short code exactly, case-insensitively, not as a substring", async () => {
        expect(await names("mt")).toEqual(["Masala Tea"]);
        expect(await names("GT1")).toEqual(["Green TEA"]);
        expect(await names("gt")).toEqual([]);
      });

      it("treats % and _ and backslash literally", async () => {
        expect(await names("%")).toEqual(["50% Off Combo"]);
        expect(await names("_")).toEqual(["Under_score"]);
        expect(await names("\\")).toEqual([]);
        expect(await names("t_a")).toEqual([]);
        expect(await names("50%")).toEqual(["50% Off Combo"]);
      });

      it("blank search returns everything", async () => {
        expect(await names("   ")).toHaveLength(5);
      });
    });
  });

  describe("createProduct / updateProduct", () => {
    it("creates a product, trims the name, stores paise and writes PRODUCT_CREATED", async () => {
      const p = await createProduct(a.owner.ctx, {
        name: "  Masala Tea  ",
        categoryId: a.categoryId,
        pricePaise: 1500,
        shortCode: "mt1",
      });
      expect(p).toMatchObject({
        categoryId: a.categoryId,
        name: "Masala Tea",
        pricePaise: 1500,
        shortCode: "mt1",
        sortOrder: 0,
        isActive: true,
      });
      const rows = await audit(a.shopId, "PRODUCT_CREATED");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: a.owner.id,
        entityType: "product",
        entityId: p.id,
        meta: { name: "Masala Tea", pricePaise: 1500 },
      });
    });

    it("allows a price of 0 and the maximum; empty short code becomes null", async () => {
      const free = await createProduct(a.owner.ctx, {
        name: "Water",
        categoryId: a.categoryId,
        pricePaise: 0,
        shortCode: "",
      });
      expect(free.pricePaise).toBe(0);
      expect(free.shortCode).toBeNull();
      const max = await createProduct(a.owner.ctx, { name: "Gold", categoryId: a.categoryId, pricePaise: 10_000_000 });
      expect(max.pricePaise).toBe(10_000_000);
      expect(max.shortCode).toBeNull();
    });

    it.each([-1, 10_000_001, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "invalid price %s throws VALIDATION and creates nothing",
      async (price) => {
        expect(
          await code(createProduct(a.owner.ctx, { name: "Tea", categoryId: a.categoryId, pricePaise: price })),
        ).toBe("VALIDATION");
        const id = await makeProduct(a.shopId, { name: "Existing", pricePaise: 100 });
        expect(await code(updateProduct(a.owner.ctx, id, { pricePaise: price }))).toBe("VALIDATION");
        expect(await db.select().from(products).where(eq(products.shopId, a.shopId))).toHaveLength(1);
        expect(await audit(a.shopId)).toHaveLength(0);
      },
    );

    it("rejects bad names and short codes", async () => {
      const base = { categoryId: a.categoryId, pricePaise: 100 };
      expect(await code(createProduct(a.owner.ctx, { ...base, name: "   " }))).toBe("VALIDATION");
      expect(await code(createProduct(a.owner.ctx, { ...base, name: "x".repeat(61) }))).toBe("VALIDATION");
      expect(await code(createProduct(a.owner.ctx, { ...base, name: "x".repeat(60) }))).toBe("NO_ERROR");
      expect(await code(createProduct(a.owner.ctx, { ...base, name: "A", shortCode: "a b" }))).toBe("VALIDATION");
      expect(await code(createProduct(a.owner.ctx, { ...base, name: "B", shortCode: "x-1" }))).toBe("VALIDATION");
      expect(await code(createProduct(a.owner.ctx, { ...base, name: "C", shortCode: "ABCDEFGHIJK" }))).toBe(
        "VALIDATION",
      );
      expect(await code(createProduct(a.owner.ctx, { ...base, name: "D", shortCode: "ABCDEFGHIJ" }))).toBe(
        "NO_ERROR",
      );
    });

    it("rejects unknown keys such as shopId", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 100 });
      expect(
        await code(updateProduct(a.owner.ctx, id, { shopId: b.shopId } as unknown as { name: string })),
      ).toBe("VALIDATION");
      expect(
        await code(
          createProduct(a.owner.ctx, {
            name: "X",
            categoryId: a.categoryId,
            pricePaise: 1,
            shopId: b.shopId,
          } as unknown as { name: string; categoryId: string; pricePaise: number }),
        ),
      ).toBe("VALIDATION");
    });

    it("a product must reference an existing category (NOT_FOUND)", async () => {
      expect(
        await code(
          createProduct(a.owner.ctx, {
            name: "Tea",
            categoryId: "00000000-0000-4000-8000-000000000000",
            pricePaise: 100,
          }),
        ),
      ).toBe("NOT_FOUND");
    });

    it("a changed price writes PRODUCT_PRICE_CHANGED with {from,to} and nothing else", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      const p = await updateProduct(a.owner.ctx, id, { pricePaise: 1800 });
      expect(p.pricePaise).toBe(1800);
      const rows = await audit(a.shopId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "PRODUCT_PRICE_CHANGED",
        entityType: "product",
        entityId: id,
        userId: a.owner.id,
        meta: { from: 1500, to: 1800 },
      });
    });

    it("price plus other fields writes PRODUCT_PRICE_CHANGED and PRODUCT_UPDATED", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      await updateProduct(a.owner.ctx, id, { pricePaise: 1600, name: "Big Samosa", shortCode: "bs" });
      const price = await audit(a.shopId, "PRODUCT_PRICE_CHANGED");
      const upd = await audit(a.shopId, "PRODUCT_UPDATED");
      expect(price).toHaveLength(1);
      expect(price[0].meta).toEqual({ from: 1500, to: 1600 });
      expect(upd).toHaveLength(1);
      expect((upd[0].meta as { changed: string[] }).changed.sort()).toEqual(["name", "shortCode"]);
    });

    it("other-field changes write only PRODUCT_UPDATED; no change writes nothing", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      const other = await createCategory(a.owner.ctx, { name: "Snacks" });
      await updateProduct(a.owner.ctx, id, { categoryId: other.id, sortOrder: 3 });
      expect(await audit(a.shopId, "PRODUCT_PRICE_CHANGED")).toHaveLength(0);
      const upd = await audit(a.shopId, "PRODUCT_UPDATED");
      expect(upd).toHaveLength(1);
      expect((upd[0].meta as { changed: string[] }).changed.sort()).toEqual(["categoryId", "sortOrder"]);

      const before = await audit(a.shopId);
      const same = await updateProduct(a.owner.ctx, id, { name: "Samosa", pricePaise: 1500, categoryId: other.id });
      expect(same).toMatchObject({ name: "Samosa", pricePaise: 1500, categoryId: other.id, sortOrder: 3 });
      expect(await updateProduct(a.owner.ctx, id, {})).toMatchObject({ id });
      expect(await audit(a.shopId)).toHaveLength(before.length);
    });

    it("shortCode can be cleared with null or an empty string", async () => {
      const p = await createProduct(a.owner.ctx, { name: "Tea", categoryId: a.categoryId, pricePaise: 100, shortCode: "T1" });
      expect((await updateProduct(a.owner.ctx, p.id, { shortCode: null })).shortCode).toBeNull();
      await updateProduct(a.owner.ctx, p.id, { shortCode: "T2" });
      expect((await updateProduct(a.owner.ctx, p.id, { shortCode: "" })).shortCode).toBeNull();
    });

    it("a failed update rolls back with its audit row", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      expect(
        await code(updateProduct(a.owner.ctx, id, { pricePaise: 2000, categoryId: b.categoryId })),
      ).toBe("NOT_FOUND");
      const [row] = await db.select().from(products).where(eq(products.id, id));
      expect(row.pricePaise).toBe(1500);
      expect(await audit(a.shopId)).toHaveLength(0);
    });
  });

  describe("setProductActive / deleteProduct", () => {
    it("disabling writes PRODUCT_DISABLED; repeating it writes nothing more", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      await setProductActive(a.owner.ctx, id, false);
      const rows = await audit(a.shopId, "PRODUCT_DISABLED");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entityType: "product", entityId: id, userId: a.owner.id });
      await setProductActive(a.owner.ctx, id, false);
      expect(await audit(a.shopId)).toHaveLength(1);
    });

    it("enabling writes PRODUCT_UPDATED {changed:['isActive']}; no row when already active", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500, isActive: false });
      await setProductActive(a.owner.ctx, id, true);
      const rows = await audit(a.shopId, "PRODUCT_UPDATED");
      expect(rows).toHaveLength(1);
      expect(rows[0].meta).toEqual({ changed: ["isActive"] });
      await setProductActive(a.owner.ctx, id, true);
      expect(await audit(a.shopId)).toHaveLength(1);
    });

    it("deleteProduct soft-deletes and writes PRODUCT_UPDATED {changed:['deleted']}", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      await deleteProduct(a.owner.ctx, id);
      const rows = await audit(a.shopId, "PRODUCT_UPDATED");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entityId: id, meta: { changed: ["deleted"] } });
    });
  });

  describe("categories", () => {
    it("creates, renames and toggles a category with CATEGORY_CHANGED audit rows", async () => {
      const c = await createCategory(a.owner.ctx, { name: "  Tea  ", sortOrder: 2 });
      expect(c).toEqual({ id: c.id, name: "Tea", sortOrder: 2, isActive: true });
      const renamed = await updateCategory(a.owner.ctx, c.id, { name: "Hot Tea" });
      expect(renamed.name).toBe("Hot Tea");
      await setCategoryActive(a.owner.ctx, c.id, false);
      await setCategoryActive(a.owner.ctx, c.id, false); // no change, no row
      const rows = await audit(a.shopId, "CATEGORY_CHANGED");
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.entityType === "category" && r.entityId === c.id)).toBe(true);
      expect(rows[0].meta).toMatchObject({ name: "Tea" });
      expect(rows[1].meta).toMatchObject({ changed: ["name"] });
      expect(rows[2].meta).toMatchObject({ changed: ["isActive"], isActive: false });
      const [cat] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, c.id), eq(categories.shopId, a.shopId)));
      expect(cat.isActive).toBe(false);
    });

    it("a duplicate category name in the same shop (case-insensitive) is CONFLICT", async () => {
      await createCategory(a.owner.ctx, { name: "Tea" });
      expect(await code(createCategory(a.owner.ctx, { name: "Tea" }))).toBe("CONFLICT");
      expect(await code(createCategory(a.owner.ctx, { name: "  tEA " }))).toBe("CONFLICT");
      expect(await code(createCategory(a.owner.ctx, { name: "general" }))).toBe("CONFLICT");
      const other = await createCategory(a.owner.ctx, { name: "Snacks" });
      expect(await code(updateCategory(a.owner.ctx, other.id, { name: "TEA" }))).toBe("CONFLICT");
      // renaming a category to a different case of its own name is fine
      expect((await updateCategory(a.owner.ctx, other.id, { name: "SNACKS" })).name).toBe("SNACKS");
      // the same name in another shop is fine
      expect(await code(createCategory(b.owner.ctx, { name: "Tea" }))).toBe("NO_ERROR");
      // failed attempts left no audit rows beyond the two successful creates and rename
      expect(await audit(a.shopId, "CATEGORY_CHANGED")).toHaveLength(3);
    });

    it("validates category names", async () => {
      expect(await code(createCategory(a.owner.ctx, { name: "   " }))).toBe("VALIDATION");
      expect(await code(createCategory(a.owner.ctx, { name: "x".repeat(61) }))).toBe("VALIDATION");
      expect(await code(updateCategory(a.owner.ctx, a.categoryId, { name: "" }))).toBe("VALIDATION");
    });

    it("products keep their own flag when their category is deactivated", async () => {
      const id = await makeProduct(a.shopId, { name: "Samosa", pricePaise: 1500 });
      await setCategoryActive(a.owner.ctx, a.categoryId, false);
      expect((await listProducts(a.owner.ctx)).map((p) => p.id)).toEqual([id]);
    });
  });
});
