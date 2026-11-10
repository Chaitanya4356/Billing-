import { requirePageContext } from "@/modules/auth/page-guard";
import { listCategories, listProducts } from "@/modules/catalog/service";
import { getBillingConfig } from "@/modules/shop/service";
import { BillingClient, type BillingCategory, type BillingProduct } from "./BillingClient";

export default async function BillingPage() {
  const ctx = await requirePageContext();
  const [config, categoryRows, productRows] = await Promise.all([
    getBillingConfig(ctx),
    listCategories(ctx),
    listProducts(ctx),
  ]);

  // Only active categories (and their active products) are offered for sale.
  const categories: BillingCategory[] = categoryRows.map((c) => ({ id: c.id, name: c.name }));
  const activeCategoryIds = new Set(categories.map((c) => c.id));
  const products: BillingProduct[] = productRows
    .filter((p) => activeCategoryIds.has(p.categoryId))
    .map((p) => ({
      id: p.id,
      name: p.name,
      pricePaise: p.pricePaise,
      shortCode: p.shortCode,
      categoryId: p.categoryId,
    }));

  return <BillingClient role={ctx.role} initialConfig={config} categories={categories} initialProducts={products} />;
}
