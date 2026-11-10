import { requirePageContext } from "@/modules/auth/page-guard";

export default async function SettingsPage() {
  await requirePageContext(["OWNER"]);
  return <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>;
}
