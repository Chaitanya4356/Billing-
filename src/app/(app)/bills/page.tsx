import type { Metadata } from "next";
import { requirePageContext } from "@/modules/auth/page-guard";
import { listBills } from "@/modules/bills/service";
import { getBillingConfig } from "@/modules/shop/service";
import { BillsTable, type BillsFilters } from "./BillsTable";

export const metadata: Metadata = { title: "Bills · Billing" };

const PAGE_SIZE = 25;
const MAX_SEARCH = 40;

type SearchParams = { [key: string]: string | string[] | undefined };

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Reads the URL's filters, dropping anything that is not valid so a hand-edited URL never errors. */
function parseFilters(params: SearchParams, isOwner: boolean): BillsFilters {
  const date = one(params.date);
  const status = one(params.status);
  const method = one(params.method);
  const page = Number(one(params.page));
  return {
    q: one(params.q).trim().slice(0, MAX_SEARCH),
    // A cashier is always fixed to today's business day: no date filter.
    date: isOwner && isRealDate(date) ? date : "",
    status: status === "COMPLETED" || status === "CANCELLED" ? status : "",
    method: method === "CASH" || method === "UPI" ? method : "",
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

export default async function BillsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePageContext();
  const filters = parseFilters(await searchParams, ctx.role === "OWNER");
  const [config, { rows, total }] = await Promise.all([
    getBillingConfig(ctx),
    listBills(ctx, {
      search: filters.q || undefined,
      date: filters.date || undefined,
      status: filters.status || undefined,
      method: filters.method || undefined,
      page: filters.page,
      pageSize: PAGE_SIZE,
    }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
      <BillsTable
        role={ctx.role}
        cashierCanCancel={config.cashierCanCancel}
        filters={filters}
        rows={rows}
        total={total}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
