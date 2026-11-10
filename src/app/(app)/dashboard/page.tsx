import { requirePageContext } from "@/modules/auth/page-guard";

export default async function DashboardPage() {
  await requirePageContext(["OWNER"]);
  return <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>;
}
