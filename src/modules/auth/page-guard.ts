import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import type { AuthContext, Role } from "@/lib/types";
import { assertRole, requireContext } from "./guards";
import { landingPathFor } from "./nav";

/**
 * Guard for pages and layouts. Returns the context, or redirects:
 * UNAUTHENTICATED -> /login, FORBIDDEN -> the user's landing page.
 * Any other error is rethrown.
 */
export async function requirePageContext(roles?: Role[]): Promise<AuthContext> {
  let ctx: AuthContext | undefined;
  let target: string | undefined;
  try {
    // Authenticate first (one session lookup), then check the role against that
    // context so a FORBIDDEN outcome still knows where to send the user.
    const authed = await requireContext();
    if (roles) {
      try {
        assertRole(authed, roles);
      } catch (e) {
        if (e instanceof AppError && e.code === "FORBIDDEN") {
          target = landingPathFor(authed.role);
        } else {
          throw e;
        }
      }
    }
    ctx = authed;
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAUTHENTICATED") {
      target = "/login";
    } else {
      throw e;
    }
  }
  // redirect() throws a control-flow error: keep it outside the try/catch.
  if (target) redirect(target);
  return ctx as AuthContext;
}
