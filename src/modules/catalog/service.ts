import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { ZodType } from "zod";
import { db } from "@/db/client";
import type { DbOrTx } from "@/db/client";
import { categories, products } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/types";
import { recordAudit } from "@/modules/audit/service";
import { assertRole } from "@/modules/auth/guards";
import {
  createCategorySchema,
  createProductSchema,
  isUuid,
  listProductsQuerySchema,
  updateCategorySchema,
  updateProductSchema,
} from "./schema";
import type {
  CreateCategoryInput,
  CreateProductInput,
  ListProductsQuery,
  UpdateCategoryInput,
  UpdateProductInput,
} from "./schema";

export interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ProductRow {
  id: string;
  categoryId: string;
  name: string;
  pricePaise: number;
  shortCode: string | null;
  sortOrder: number;
  isActive: boolean;
}

const categoryColumns = {
  id: categories.id,
  name: categories.name,
  sortOrder: categories.sortOrder,
  isActive: categories.isActive,
};

const productColumns = {
  id: products.id,
  categoryId: products.categoryId,
  name: products.name,
  pricePaise: products.pricePaise,
  shortCode: products.shortCode,
  sortOrder: products.sortOrder,
  isActive: products.isActive,
};

function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new AppError("VALIDATION", r.error.issues[0]?.message ?? "Invalid input", r.error.issues);
  }
  return r.data;
}

/** A malformed id can never match a row; treat it as missing rather than a database error. */
function assertUuid(id: string, what: string): void {
  if (!isUuid(id)) throw new AppError("NOT_FOUND", `${what} not found`);
}

/** True for a Postgres unique violation (SQLSTATE 23505), also when wrapped by drizzle. */
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const DUPLICATE_CATEGORY = "A category with that name already exists";

/** Escapes LIKE wildcards so the user's term is matched literally. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------- categories

/** Categories ordered by sort order then name. Readable by both roles. */
export async function listCategories(
  ctx: AuthContext,
  opts: { includeInactive?: boolean } = {},
): Promise<CategoryRow[]> {
  assertRole(ctx, ["OWNER", "CASHIER"]);
  const where = opts.includeInactive
    ? eq(categories.shopId, ctx.shopId)
    : and(eq(categories.shopId, ctx.shopId), eq(categories.isActive, true));
  return db
    .select(categoryColumns)
    .from(categories)
    .where(where)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export async function createCategory(ctx: AuthContext, input: CreateCategoryInput): Promise<CategoryRow> {
  assertRole(ctx, ["OWNER"]);
  const i = parseOrThrow(createCategorySchema, input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(categories)
        .values({ shopId: ctx.shopId, name: i.name, sortOrder: i.sortOrder ?? 0 })
        .returning(categoryColumns);
      await recordAudit(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        action: "CATEGORY_CHANGED",
        entityType: "category",
        entityId: row.id,
        meta: { name: row.name },
      });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", DUPLICATE_CATEGORY);
    throw e;
  }
}

export async function updateCategory(
  ctx: AuthContext,
  id: string,
  patch: UpdateCategoryInput,
): Promise<CategoryRow> {
  assertRole(ctx, ["OWNER"]);
  const p = parseOrThrow(updateCategorySchema, patch);
  assertUuid(id, "Category");
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select(categoryColumns)
        .from(categories)
        .where(and(eq(categories.id, id), eq(categories.shopId, ctx.shopId)))
        .for("update");
      if (!current) throw new AppError("NOT_FOUND", "Category not found");

      const changes: Partial<Pick<CategoryRow, "name" | "sortOrder">> = {};
      if (p.name !== undefined && p.name !== current.name) changes.name = p.name;
      if (p.sortOrder !== undefined && p.sortOrder !== current.sortOrder) changes.sortOrder = p.sortOrder;
      const changed = Object.keys(changes);
      if (changed.length === 0) return current;

      const [row] = await tx
        .update(categories)
        .set(changes)
        .where(and(eq(categories.id, id), eq(categories.shopId, ctx.shopId)))
        .returning(categoryColumns);
      await recordAudit(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        action: "CATEGORY_CHANGED",
        entityType: "category",
        entityId: id,
        meta: { changed },
      });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", DUPLICATE_CATEGORY);
    throw e;
  }
}

export async function setCategoryActive(ctx: AuthContext, id: string, active: boolean): Promise<void> {
  assertRole(ctx, ["OWNER"]);
  assertUuid(id, "Category");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ isActive: categories.isActive })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.shopId, ctx.shopId)))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND", "Category not found");
    if (current.isActive === active) return;
    await tx
      .update(categories)
      .set({ isActive: active })
      .where(and(eq(categories.id, id), eq(categories.shopId, ctx.shopId)));
    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: "CATEGORY_CHANGED",
      entityType: "category",
      entityId: id,
      meta: { changed: ["isActive"], isActive: active },
    });
  });
}

// ------------------------------------------------------------------ products

/**
 * Products ordered by sort order then name. Readable by both roles. Never
 * returns soft-deleted rows. `search` is a case-insensitive substring match on
 * the name, or an exact (case-insensitive) match on the short code.
 */
export async function listProducts(ctx: AuthContext, query: ListProductsQuery = {}): Promise<ProductRow[]> {
  assertRole(ctx, ["OWNER", "CASHIER"]);
  const q = parseOrThrow(listProductsQuerySchema, query);
  const conditions: SQL[] = [eq(products.shopId, ctx.shopId), isNull(products.deletedAt)];
  if (!q.includeInactive) conditions.push(eq(products.isActive, true));
  if (q.categoryId) conditions.push(eq(products.categoryId, q.categoryId));
  const term = q.search?.trim();
  if (term) {
    const match = or(
      ilike(products.name, `%${escapeLike(term)}%`),
      sql`lower(${products.shortCode}) = lower(${term})`,
    );
    if (match) conditions.push(match);
  }
  return db
    .select(productColumns)
    .from(products)
    .where(and(...conditions))
    .orderBy(asc(products.sortOrder), asc(products.name), asc(products.id));
}

async function assertCategoryInShop(tx: DbOrTx, ctx: AuthContext, categoryId: string): Promise<void> {
  if (!isUuid(categoryId)) throw new AppError("NOT_FOUND", "Category not found");
  const [cat] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.shopId, ctx.shopId)));
  if (!cat) throw new AppError("NOT_FOUND", "Category not found");
}

export async function createProduct(ctx: AuthContext, input: CreateProductInput): Promise<ProductRow> {
  assertRole(ctx, ["OWNER"]);
  const i = parseOrThrow(createProductSchema, input);
  return db.transaction(async (tx) => {
    await assertCategoryInShop(tx, ctx, i.categoryId);
    const [row] = await tx
      .insert(products)
      .values({
        shopId: ctx.shopId,
        categoryId: i.categoryId,
        name: i.name,
        pricePaise: i.pricePaise,
        shortCode: i.shortCode ?? null,
        sortOrder: i.sortOrder ?? 0,
      })
      .returning(productColumns);
    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: "PRODUCT_CREATED",
      entityType: "product",
      entityId: row.id,
      meta: { name: row.name, pricePaise: row.pricePaise },
    });
    return row;
  });
}

const PATCH_KEYS = ["name", "categoryId", "pricePaise", "shortCode", "sortOrder"] as const;

/**
 * Applies a partial patch. OWNER only. A price change is audited as
 * PRODUCT_PRICE_CHANGED {from,to}; any other changed fields as one
 * PRODUCT_UPDATED {changed}. Nothing is written when nothing changes.
 */
export async function updateProduct(
  ctx: AuthContext,
  id: string,
  patch: UpdateProductInput,
): Promise<ProductRow> {
  assertRole(ctx, ["OWNER"]);
  const p = parseOrThrow(updateProductSchema, patch);
  assertUuid(id, "Product");
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select(productColumns)
      .from(products)
      .where(and(eq(products.id, id), eq(products.shopId, ctx.shopId), isNull(products.deletedAt)))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND", "Product not found");

    const changes: Partial<Omit<ProductRow, "id" | "isActive">> = {};
    for (const key of PATCH_KEYS) {
      const next = p[key];
      if (next !== undefined && next !== current[key]) Object.assign(changes, { [key]: next });
    }
    const keys = Object.keys(changes) as Array<(typeof PATCH_KEYS)[number]>;
    if (keys.length === 0) return current;

    if (changes.categoryId !== undefined) await assertCategoryInShop(tx, ctx, changes.categoryId);

    const [row] = await tx
      .update(products)
      .set(changes)
      .where(and(eq(products.id, id), eq(products.shopId, ctx.shopId)))
      .returning(productColumns);

    if (changes.pricePaise !== undefined) {
      await recordAudit(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        action: "PRODUCT_PRICE_CHANGED",
        entityType: "product",
        entityId: id,
        meta: { from: current.pricePaise, to: changes.pricePaise },
      });
    }
    const others = keys.filter((k) => k !== "pricePaise");
    if (others.length > 0) {
      await recordAudit(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        action: "PRODUCT_UPDATED",
        entityType: "product",
        entityId: id,
        meta: { changed: others },
      });
    }
    return row;
  });
}

export async function setProductActive(ctx: AuthContext, id: string, active: boolean): Promise<void> {
  assertRole(ctx, ["OWNER"]);
  assertUuid(id, "Product");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ isActive: products.isActive })
      .from(products)
      .where(and(eq(products.id, id), eq(products.shopId, ctx.shopId), isNull(products.deletedAt)))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND", "Product not found");
    if (current.isActive === active) return;
    await tx
      .update(products)
      .set({ isActive: active })
      .where(and(eq(products.id, id), eq(products.shopId, ctx.shopId)));
    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: active ? "PRODUCT_UPDATED" : "PRODUCT_DISABLED",
      entityType: "product",
      entityId: id,
      meta: active ? { changed: ["isActive"] } : {},
    });
  });
}

/** Soft delete: sets deleted_at. Bills keep referencing the row. */
export async function deleteProduct(ctx: AuthContext, id: string): Promise<void> {
  assertRole(ctx, ["OWNER"]);
  assertUuid(id, "Product");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, id), eq(products.shopId, ctx.shopId), isNull(products.deletedAt)))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND", "Product not found");
    await tx
      .update(products)
      .set({ deletedAt: new Date() })
      .where(and(eq(products.id, id), eq(products.shopId, ctx.shopId)));
    await recordAudit(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      action: "PRODUCT_UPDATED",
      entityType: "product",
      entityId: id,
      meta: { changed: ["deleted"] },
    });
  });
}
