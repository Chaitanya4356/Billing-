import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/types";
import { requireContext } from "@/modules/auth/guards";
import { currentBusinessDate } from "@/modules/bills/service";
import { buildReportCsv } from "@/modules/reports/csv";
import { parseReportParams } from "@/modules/reports/params";
import { getBillsForCsv, getSalesSummary, rangeForPeriod } from "@/modules/reports/service";

// Reads the session cookie: always rendered per request, never cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE },
  });
}

/** Maps an error to a short, fixed response; internals are never sent to the client. */
function failure(e: unknown): Response {
  if (e instanceof AppError) {
    if (e.code === "UNAUTHENTICATED") return text(401, "Please sign in.");
    if (e.code === "FORBIDDEN") return text(403, "Not allowed.");
    if (e.code === "VALIDATION") return text(400, "Invalid period or date.");
  }
  console.error(e);
  return text(500, "Could not export the report.");
}

/** GET /reports/export?period=day|week|month&date=YYYY-MM-DD: the owner's sales CSV. */
export async function GET(request: Request): Promise<Response> {
  try {
    // No redirect() here: a download endpoint answers 401/403, never an HTML page.
    const ctx: AuthContext = await requireContext(["OWNER"]);

    const params = new URL(request.url).searchParams;
    const parsed = parseReportParams(params.get("period"), params.get("date"));
    if (parsed.invalid) return text(400, "Invalid period or date.");

    const range = rangeForPeriod(parsed.period, parsed.date ?? (await currentBusinessDate(ctx)));
    const [rows, summary] = await Promise.all([getBillsForCsv(ctx, range), getSalesSummary(ctx, range)]);

    return new Response(buildReportCsv(rows, summary), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales-${range.from}-to-${range.to}.csv"`,
        "X-Content-Type-Options": "nosniff",
        ...NO_STORE,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
