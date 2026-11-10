import { requirePageContext } from "@/modules/auth/page-guard";

export default async function ProductsPage() {
  await requirePageContext(["OWNER"]);
  return <h1 className="text-2xl font-semibold tracking-tight">Products</h1>;
}
