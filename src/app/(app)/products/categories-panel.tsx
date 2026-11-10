"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  createCategoryAction,
  setCategoryActiveAction,
  updateCategoryAction,
} from "@/modules/catalog/actions";
import type { CategoryRow } from "@/modules/catalog/service";
import { Switch } from "./switch";

const INPUT = "min-h-11 w-full rounded border border-gray-300 px-3 py-2";
const BUTTON = "min-h-11 rounded border border-gray-300 px-3 text-sm font-medium hover:bg-gray-50";

export function CategoriesPanel({
  categories,
  selectedId,
}: {
  categories: CategoryRow[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function addCategory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("new-category") ?? "").trim();
    if (name === "") {
      setError("Enter a category name");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createCategoryAction({ name });
      if (result.ok) {
        form.reset();
        router.push(`/products?category=${result.data.id}`);
      } else {
        setError(result.error.message);
      }
    });
  }

  function renameCategory(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("rename") ?? "").trim();
    if (name === "") {
      setError("Enter a category name");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateCategoryAction(id, { name });
      if (result.ok) setEditingId(null);
      else setError(result.error.message);
    });
  }

  function toggleActive(id: string, active: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setCategoryActiveAction(id, active);
      if (!result.ok) setError(result.error.message);
    });
  }

  return (
    <section aria-label="Categories" className="space-y-3">
      <h2 className="text-lg font-semibold">Categories</h2>
      <ul className="space-y-1">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-1">
            {editingId === c.id ? (
              <form onSubmit={(e) => renameCategory(e, c.id)} noValidate className="flex-1 space-y-2">
                <label htmlFor="rename" className="block text-sm font-medium">
                  Category name
                </label>
                <input
                  id="rename"
                  name="rename"
                  type="text"
                  defaultValue={c.name}
                  maxLength={60}
                  autoComplete="off"
                  autoFocus
                  className={INPUT}
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={pending} className={`${BUTTON} bg-black text-white hover:bg-black`}>
                    Save name
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className={BUTTON}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <Link
                  href={`/products?category=${c.id}`}
                  aria-current={c.id === selectedId ? "page" : undefined}
                  className={`flex min-h-11 flex-1 items-center rounded px-3 text-sm font-medium ${
                    c.id === selectedId ? "bg-gray-100" : "hover:bg-gray-50"
                  } ${c.isActive ? "" : "text-gray-500"}`}
                >
                  {c.name}
                </Link>
                <button
                  type="button"
                  aria-label={`Rename ${c.name}`}
                  onClick={() => {
                    setError(null);
                    setEditingId(c.id);
                  }}
                  className="min-h-11 rounded px-2 text-sm text-gray-600 hover:text-black"
                >
                  Rename
                </button>
                <Switch
                  checked={c.isActive}
                  disabled={pending}
                  label={`Category ${c.name} active`}
                  onChange={(next) => toggleActive(c.id, next)}
                />
              </>
            )}
          </li>
        ))}
      </ul>
      {categories.length === 0 ? <p className="text-sm text-gray-600">No categories yet. Add one to start.</p> : null}

      <form onSubmit={addCategory} noValidate className="space-y-2">
        <label htmlFor="new-category" className="block text-sm font-medium">
          New category name
        </label>
        <input
          id="new-category"
          name="new-category"
          type="text"
          maxLength={60}
          autoComplete="off"
          aria-describedby={error ? "category-error" : undefined}
          className={INPUT}
        />
        <button type="submit" disabled={pending} className={`${BUTTON} bg-black text-white hover:bg-black`}>
          Add category
        </button>
      </form>
      {error ? (
        <p id="category-error" role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
