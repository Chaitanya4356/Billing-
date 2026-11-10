import { describe, expect, it } from "vitest";
import { landingPathFor, navItemsForRole } from "@/modules/auth/nav";

describe("navItemsForRole", () => {
  it("gives the owner all six items in order", () => {
    expect(navItemsForRole("OWNER")).toEqual([
      { label: "Billing", href: "/billing" },
      { label: "Bills", href: "/bills" },
      { label: "Products", href: "/products" },
      { label: "Reports", href: "/reports" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Settings", href: "/settings" },
    ]);
  });

  it("gives the cashier only Billing and Bills", () => {
    expect(navItemsForRole("CASHIER")).toEqual([
      { label: "Billing", href: "/billing" },
      { label: "Bills", href: "/bills" },
    ]);
  });
});

describe("landingPathFor", () => {
  it("sends the owner to the dashboard and the cashier to billing", () => {
    expect(landingPathFor("OWNER")).toBe("/dashboard");
    expect(landingPathFor("CASHIER")).toBe("/billing");
  });
});
