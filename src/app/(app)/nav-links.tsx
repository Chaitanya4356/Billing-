"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/modules/auth/nav";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex gap-1 md:flex-col">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                "flex min-h-11 items-center rounded px-3 text-sm font-medium whitespace-nowrap " +
                (active ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100")
              }
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
