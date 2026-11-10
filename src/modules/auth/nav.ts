import type { Role } from "@/lib/types";

export interface NavItem {
  label: string;
  href: string;
}

const CASHIER_ITEMS: NavItem[] = [
  { label: "Billing", href: "/billing" },
  { label: "Bills", href: "/bills" },
];

const OWNER_ITEMS: NavItem[] = [
  ...CASHIER_ITEMS,
  { label: "Products", href: "/products" },
  { label: "Reports", href: "/reports" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Settings", href: "/settings" },
];

/** Navigation entries visible to a role, in display order. */
export function navItemsForRole(role: Role): NavItem[] {
  return (role === "OWNER" ? OWNER_ITEMS : CASHIER_ITEMS).map((item) => ({ ...item }));
}

/** Where a signed-in user of this role starts. */
export function landingPathFor(role: Role): string {
  return role === "OWNER" ? "/dashboard" : "/billing";
}
