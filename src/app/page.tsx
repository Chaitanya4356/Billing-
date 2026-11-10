import { redirect } from "next/navigation";
import { getCurrentContext } from "@/modules/auth/guards";
import { landingPathFor } from "@/modules/auth/nav";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ctx = await getCurrentContext();
  redirect(ctx ? landingPathFor(ctx.role) : "/login");
}
