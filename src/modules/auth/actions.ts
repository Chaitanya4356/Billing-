"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runAction } from "@/lib/errors";
import { login } from "./service";
import { SESSION_COOKIE, logout } from "./session";

export interface LoginState {
  error?: string;
}

/** Server action for the login form (use with useActionState). */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = formData.get("username");
  const password = formData.get("password");
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
    return { error: "Enter your username and password" };
  }

  const result = await runAction(() => login(username, password));
  if (!result.ok) return { error: result.error.message };

  const { token, expiresAt, ctx } = result.data;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });

  // redirect() throws a control-flow error: keep it outside try/catch and runAction.
  redirect(ctx.role === "OWNER" ? "/dashboard" : "/billing");
}

/** Deletes the current session (DB row and cookie) and returns to /login. */
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await runAction(() => logout(token));
  }
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
