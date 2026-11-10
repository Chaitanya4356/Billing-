"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { createProductAction, deleteProductAction, updateProductAction } from "@/modules/catalog/actions";
import { buildProductInput, type ProductFormErrors } from "@/modules/catalog/form-parse";
import type { CategoryRow, ProductRow } from "@/modules/catalog/service";
import { paiseToRupeeInput } from "@/modules/shop/form-parse";
import { SelectField, text, TextField } from "../settings/form-kit";

/**
 * Add/edit slide-over: a native modal <dialog> pinned to the right edge, which
 * gives focus trapping, Escape to close and an inert background for free.
 * Mount it only while open.
 */
export function ProductPanel({
  product,
  categories,
  defaultCategoryId,
  onClose,
}: {
  /** The product being edited, or null to add a new one. */
  product: ProductRow | null;
  categories: CategoryRow[];
  defaultCategoryId: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => dialogRef.current?.close();
  const currentCategoryId = product?.categoryId ?? defaultCategoryId;
  const categoryOptions = categories
    .filter((c) => c.isActive || c.id === currentCategoryId)
    .map((c) => ({ value: c.id, label: c.name }));

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const d = new FormData(e.currentTarget);
    const built = buildProductInput({
      name: text(d, "product-name"),
      priceText: text(d, "product-price"),
      shortCode: text(d, "product-shortCode"),
      categoryId: text(d, "product-categoryId"),
    });
    if ("errors" in built) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = product
        ? await updateProductAction(product.id, built.value)
        : await createProductAction(built.value);
      if (result.ok) close();
      else setFormError(result.error.message);
    });
  }

  function confirmRemove() {
    if (!product) return;
    setFormError(null);
    startTransition(async () => {
      const result = await deleteProductAction(product.id);
      if (result.ok) close();
      else setFormError(result.error.message);
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="product-panel-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4 p-6">
        <h2 id="product-panel-title" className="text-xl font-semibold">
          {product ? "Edit product" : "Add product"}
        </h2>
        <TextField
          id="product-name"
          label="Product name"
          defaultValue={product?.name ?? ""}
          maxLength={60}
          error={errors.name}
        />
        <TextField
          id="product-price"
          label="Price (₹)"
          hint="In rupees, for example 15 or 12.50."
          defaultValue={product ? paiseToRupeeInput(product.pricePaise) : ""}
          inputMode="decimal"
          error={errors.price}
        />
        <TextField
          id="product-shortCode"
          label="Short code (optional)"
          hint="Up to 10 letters or digits, for quick search at the counter."
          defaultValue={product?.shortCode ?? ""}
          maxLength={10}
          error={errors.shortCode}
        />
        <SelectField
          id="product-categoryId"
          label="Category"
          defaultValue={currentCategoryId}
          options={categoryOptions}
        />
        {formError ? (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded bg-black px-4 font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save product"}
          </button>
          <button type="button" onClick={close} className="min-h-11 rounded border border-gray-300 px-4 font-medium">
            Cancel
          </button>
        </div>

        {product ? (
          <div className="space-y-2 border-t border-gray-200 pt-4">
            {confirmDelete ? (
              <>
                <p className="text-sm">Delete {product.name}? It will no longer be sold or listed.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={confirmRemove}
                    disabled={pending}
                    className="min-h-11 rounded bg-red-600 px-4 font-medium text-white disabled:opacity-50"
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-11 rounded border border-gray-300 px-4 font-medium"
                  >
                    Keep product
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="min-h-11 rounded border border-red-300 px-4 font-medium text-red-700"
              >
                Delete product
              </button>
            )}
          </div>
        ) : null}
      </form>
    </dialog>
  );
}
