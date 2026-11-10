"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { runAction, type ActionResult } from "@/lib/errors";
import { requireContext } from "@/modules/auth/guards";
import { SESSION_COOKIE } from "@/modules/auth/session";
import type { CreateCashierInput } from "./schema";
import { changeOwnPassword, createCashier, resetPassword, setUserActive, type UserRow } from "./service";

// Thin wrappers: the services validate input and check the role again.

export async function createCashierAction(input: CreateCashierInput): Promise<ActionResult<UserRow>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    const row = await createCashier(ctx, input);
    revalidatePath("/settings");
    return row;
  });
}

export async function resetPasswordAction(userId: string, newPassword: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    await resetPassword(ctx, userId, newPassword);
    return null;
  });
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    await setUserActive(ctx, userId, active);
    revalidatePath("/settings");
    return null;
  });
}

/**
 * Changes the signed-in owner's password. Every session of the owner is
 * revoked (this one too), so on success the session cookie is cleared and the
 * client navigates to /login.
 */
export async function changeOwnPasswordAction(current: string, next: string): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    await changeOwnPassword(ctx, current, next);
    return null;
  });
  if (result.ok) (await cookies()).delete(SESSION_COOKIE);
  return result;
}
