"use client";

import { useState, useTransition } from "react";
import { setProductActiveAction } from "@/modules/catalog/actions";
import type { CategoryRow, ProductRow } from "@/modules/catalog/service";
import { formatPaise } from "@/lib/money";
import { ProductPanel } from "./product-panel";
import { Switch } from "./switch";

type PanelState = { kind: "add" } | { kind: "edit"; product: ProductRow } | null;

export function ProductsTable({
  category,
  categories,
  products,
}: {
  category: CategoryRow;
  categories: CategoryRow[];
  products: ProductRow[];
}) {
  const [panel, setPanel] = useState<PanelState>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(p: ProductRow, active: boolean) {
    setError(null);
    setPendingId(p.id);
    startTransition(async () => {
      const result = await setProductActiveAction(p.id, active);
      if (!result.ok) setError(result.error.message);
      setPendingId(null);
    });
  }

  return (
    <section aria-label={`Products in ${category.name}`} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{category.name}</h2>
        <button
          type="button"
          onClick={() => setPanel({ kind: "add" })}
          className="min-h-11 rounded bg-black px-4 text-sm font-medium text-white"
        >
          Add product
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {products.length === 0 ? (
        <p className="text-sm text-gray-600">No products in this category yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-600">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Name
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Price
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Short code
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Enabled
                </th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={`border-b border-gray-100 ${p.isActive ? "" : "text-gray-500"}`}>
                  <th scope="row" className="py-1 pr-3 font-medium">
                    {p.name}
                  </th>
                  <td className="py-1 pr-3 tabular-nums">{formatPaise(p.pricePaise)}</td>
                  <td className="py-1 pr-3">{p.shortCode ?? ""}</td>
                  <td className="py-1 pr-3">
                    <Switch
                      checked={p.isActive}
                      disabled={pendingId === p.id}
                      label={`Product ${p.name} enabled`}
                      onChange={(next) => toggle(p, next)}
                    />
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      aria-label={`Edit ${p.name}`}
                      onClick={() => setPanel({ kind: "edit", product: p })}
                      className="min-h-11 rounded border border-gray-300 px-3 font-medium hover:bg-gray-50"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel ? (
        <ProductPanel
          key={panel.kind === "edit" ? panel.product.id : "add"}
          product={panel.kind === "edit" ? panel.product : null}
          categories={categories}
          defaultCategoryId={category.id}
          onClose={() => setPanel(null)}
        />
      ) : null}
    </section>
  );
}
