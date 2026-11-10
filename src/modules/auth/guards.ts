import { AppError } from "@/lib/errors";
import type { AuthContext, Role } from "@/lib/types";

// This module must stay importable without a Next request context or a
// database (unit tests import assertRole), so next/headers and the session
// module (which opens the DB pool) are imported lazily.

/** Pure role check. Throws FORBIDDEN when ctx.role is not in roles. */
export function assertRole(ctx: AuthContext, roles: Role[]): void {
  if (!roles.includes(ctx.role)) {
    throw new AppError("FORBIDDEN", "You do not have permission to do that");
  }
}

/** Reads the `session` cookie and validates it against the database. */
export async function getCurrentContext(): Promise<AuthContext | null> {
  const { cookies } = await import("next/headers");
  const { SESSION_COOKIE, validateSession } = await import("./session");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(token);
}

/** Throws UNAUTHENTICATED without a valid session, FORBIDDEN on role mismatch. */
export async function requireContext(roles?: Role[]): Promise<AuthContext> {
  const ctx = await getCurrentContext();
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in");
  if (roles) assertRole(ctx, roles);
  return ctx;
}
