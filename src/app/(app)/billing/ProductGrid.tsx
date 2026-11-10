"use client";

import type { KeyboardEvent, RefObject } from "react";
import { formatPaise } from "@/lib/money";
import { searchProducts } from "@/modules/billing/screen";
import type { BillingCategory, BillingProduct } from "./BillingClient";

export const ALL_CATEGORIES = "all";

/** Products shown for the current search (all categories) or, without a search, the selected chip. */
export function visibleProducts(products: BillingProduct[], search: string, categoryId: string): BillingProduct[] {
  if (search.trim()) return searchProducts(products, search);
  return categoryId === ALL_CATEGORIES ? products : products.filter((p) => p.categoryId === categoryId);
}

export function ProductGrid({
  categories,
  products,
  search,
  onSearchChange,
  categoryId,
  onCategoryChange,
  onAdd,
  searchRef,
  disabled,
}: {
  categories: BillingCategory[];
  products: BillingProduct[];
  search: string;
  onSearchChange: (value: string) => void;
  categoryId: string;
  onCategoryChange: (id: string) => void;
  onAdd: (product: BillingProduct) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
}) {
  const visible = visibleProducts(products, search, categoryId);
  const searching = search.trim() !== "";

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Ctrl/Cmd+Enter is the charge shortcut, handled by the screen.
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    e.preventDefault();
    const top = visible[0];
    if (!searching || !top || disabled) return;
    onAdd(top);
    onSearchChange("");
  }

  const chips = [{ id: ALL_CATEGORIES, name: "All" }, ...categories];

  return (
    <section aria-label="Products" className="flex min-w-0 flex-col gap-3">
      <div>
        <label htmlFor="billing-search" className="sr-only">
          Search products
        </label>
        <input
          ref={searchRef}
          id="billing-search"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search products or short code  ( / )"
          autoComplete="off"
          aria-keyshortcuts="/"
          className="min-h-12 w-full rounded-lg border border-gray-300 px-4 text-base focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
        />
      </div>

      <div role="group" aria-label="Categories" className="flex gap-2 overflow-x-auto pb-1">
        {chips.map((c) => {
          const active = !searching && c.id === categoryId;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onCategoryChange(c.id);
                if (searching) onSearchChange("");
              }}
              className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap ${
                active ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-100"
              }`}
            >
              {c.name}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600">
          {searching ? `No products match "${search.trim()}".` : "No products in this category."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onAdd(p)}
              aria-label={`Add ${p.name}, ${formatPaise(p.pricePaise)}`}
              className="flex min-h-20 flex-col items-start justify-between gap-1 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm hover:border-gray-400 active:bg-gray-100 disabled:opacity-60"
            >
              <span className="text-base leading-tight font-medium text-gray-900">{p.name}</span>
              <span className="text-sm text-gray-600 tabular-nums">{formatPaise(p.pricePaise)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
