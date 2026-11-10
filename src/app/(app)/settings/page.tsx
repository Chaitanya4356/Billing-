import type { Metadata } from "next";
import Link from "next/link";
import { requirePageContext } from "@/modules/auth/page-guard";
import { getSettings } from "@/modules/shop/service";
import { listUsers } from "@/modules/users/service";
import { DiscountsForm, GstForm, NumberingForm, ShopForm } from "./settings-forms";
import { ReceiptTab } from "./ReceiptTab";
import { resolveTab, SETTINGS_TABS } from "./tabs";
import { UsersTab } from "./UsersTab";

export const metadata: Metadata = { title: "Settings · Billing" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const ctx = await requirePageContext(["OWNER"]);
  const tab = resolveTab((await searchParams).tab);
  const { shop, settings } = await getSettings(ctx);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {SETTINGS_TABS.map((t) => (
          <Link
            key={t.id}
            href={`/settings?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${
              t.id === tab ? "border-black" : "border-transparent text-gray-600 hover:text-black"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <section aria-label={SETTINGS_TABS.find((t) => t.id === tab)?.label}>
        {tab === "shop" ? <ShopForm shop={shop} /> : null}
        {tab === "numbering" ? <NumberingForm settings={settings} /> : null}
        {tab === "gst" ? <GstForm settings={settings} /> : null}
        {tab === "discounts" ? <DiscountsForm settings={settings} /> : null}
        {tab === "receipt" ? <ReceiptTab shop={shop} settings={settings} /> : null}
        {tab === "users" ? <UsersTab users={await listUsers(ctx)} /> : null}
      </section>
    </div>
  );
}
