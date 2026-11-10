"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { runAction } from "@/lib/errors";
import {
  LOGIN_RATE_LIMITED_MESSAGE,
  clientKeyFromHeaders,
  isLoginRateLimitEnabled,
  loginRateLimiter,
} from "./rate-limit";
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

  // Per-client throttle in front of argon2, the DB and the audit log: a refused
  // attempt does no DB access, no password hashing and writes no audit row.
  if (isLoginRateLimitEnabled(process.env)) {
    const h = await headers();
    const key = clientKeyFromHeaders((name) => h.get(name));
    if (!loginRateLimiter.attempt(key).allowed) return { error: LOGIN_RATE_LIMITED_MESSAGE };
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
