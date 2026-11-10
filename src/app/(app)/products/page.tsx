import type { Metadata } from "next";
import { requirePageContext } from "@/modules/auth/page-guard";
import { listCategories, listProducts } from "@/modules/catalog/service";
import { CategoriesPanel } from "./categories-panel";
import { ProductsTable } from "./products-table";

export const metadata: Metadata = { title: "Products · Billing" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const ctx = await requirePageContext(["OWNER"]);
  const requested = (await searchParams).category;
  const categories = await listCategories(ctx, { includeInactive: true });
  const selected =
    categories.find((c) => c.id === (typeof requested === "string" ? requested : undefined)) ??
    categories[0] ??
    null;
  const products = selected
    ? await listProducts(ctx, { categoryId: selected.id, includeInactive: true })
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
      <div className="grid gap-8 md:grid-cols-[16rem_1fr]">
        <CategoriesPanel categories={categories} selectedId={selected?.id ?? null} />
        {selected ? (
          <ProductsTable key={selected.id} category={selected} categories={categories} products={products} />
        ) : (
          <p className="text-sm text-gray-600">Add a category to start adding products.</p>
        )}
      </div>
    </div>
  );
}
