"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/errors";
import { requireContext } from "@/modules/auth/guards";
import type {
  CreateCategoryInput,
  CreateProductInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "./schema";
import {
  createCategory,
  createProduct,
  deleteProduct,
  setCategoryActive,
  setProductActive,
  updateCategory,
  updateProduct,
  type CategoryRow,
  type ProductRow,
} from "./service";

// Thin wrappers: authenticate, call the service (which checks the role and
// validates the input), refresh the Products page. No redirects in here.

export async function createCategoryAction(input: CreateCategoryInput): Promise<ActionResult<CategoryRow>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    const row = await createCategory(ctx, input);
    revalidatePath("/products");
    return row;
  });
}

export async function updateCategoryAction(
  id: string,
  patch: UpdateCategoryInput,
): Promise<ActionResult<CategoryRow>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    const row = await updateCategory(ctx, id, patch);
    revalidatePath("/products");
    return row;
  });
}

export async function setCategoryActiveAction(id: string, active: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    await setCategoryActive(ctx, id, active);
    revalidatePath("/products");
    return null;
  });
}

export async function createProductAction(input: CreateProductInput): Promise<ActionResult<ProductRow>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    const row = await createProduct(ctx, input);
    revalidatePath("/products");
    return row;
  });
}

export async function updateProductAction(
  id: string,
  patch: UpdateProductInput,
): Promise<ActionResult<ProductRow>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    const row = await updateProduct(ctx, id, patch);
    revalidatePath("/products");
    return row;
  });
}

export async function setProductActiveAction(id: string, active: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    await setProductActive(ctx, id, active);
    revalidatePath("/products");
    return null;
  });
}

export async function deleteProductAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    await deleteProduct(ctx, id);
    revalidatePath("/products");
    return null;
  });
}
