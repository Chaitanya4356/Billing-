import { logoutAction } from "@/modules/auth/actions";
import { navItemsForRole } from "@/modules/auth/nav";
import { requirePageContext } from "@/modules/auth/page-guard";
import { NavLinks } from "./nav-links";

// Every page under (app) needs a signed-in user: no static prerendering.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Any role; pages that are owner-only call requirePageContext(["OWNER"]) themselves
  // because layouts do not re-render on client navigation.
  const ctx = await requirePageContext();
  const items = navItemsForRole(ctx.role);

  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <header className="flex items-center gap-2 border-b border-gray-200 px-2 py-1 md:w-48 md:shrink-0 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-4">
        <span className="hidden px-3 pb-2 text-lg font-semibold tracking-tight md:block">Billing</span>
        <nav aria-label="Main" className="min-w-0 flex-1 overflow-x-auto md:flex-none md:overflow-visible">
          <NavLinks items={items} />
        </nav>
        <form action={logoutAction} className="md:mt-auto">
          <button
            type="submit"
            className="min-h-11 w-full rounded px-3 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Logout
          </button>
        </form>
      </header>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
