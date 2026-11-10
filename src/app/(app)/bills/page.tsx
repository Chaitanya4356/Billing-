import { requirePageContext } from "@/modules/auth/page-guard";

export default async function BillsPage() {
  await requirePageContext();
  return <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>;
}
