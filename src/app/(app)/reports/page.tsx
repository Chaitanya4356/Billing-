import type { Metadata } from "next";
import Link from "next/link";
import { AppError } from "@/lib/errors";
import { formatPaise } from "@/lib/money";
import { requirePageContext } from "@/modules/auth/page-guard";
import { currentBusinessDate } from "@/modules/bills/service";
import { parseReportParams, type ReportPeriod } from "@/modules/reports/params";
import {
  getDailyBreakdown,
  getSalesSummary,
  getTopItems,
  rangeForPeriod,
  type DailyRow,
  type SalesSummary,
  type TopItem,
} from "@/modules/reports/service";
import { StatCard, StatGrid } from "../stat-card";

export const metadata: Metadata = { title: "Reports · Billing" };

type SearchParams = { [key: string]: string | string[] | undefined };

const TOP_ITEMS_LIMIT = 10;
const TABS: Array<{ period: ReportPeriod; label: string }> = [
  { period: "day", label: "Day" },
  { period: "week", label: "Week" },
  { period: "month", label: "Month" },
];

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const TH = "py-2 pr-3 font-medium";
const THR = "py-2 pl-3 text-right font-medium";
const TDR = "py-1 pl-3 text-right tabular-nums";

interface Report {
  summary: SalesSummary;
  daily: DailyRow[];
  top: TopItem[];
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePageContext(["OWNER"]);
  const raw = await searchParams;
  // A hand-edited period or date never errors: anything invalid falls back to the defaults.
  const parsed = parseReportParams(one(raw.period), one(raw.date));
  const period = parsed.period;
  const date = parsed.date ?? (await currentBusinessDate(ctx));

  let report: Report | null = null;
  let failure: string | null = null;
  let range = { from: date, to: date };
  try {
    range = rangeForPeriod(period, date);
    const [summary, daily, top] = await Promise.all([
      getSalesSummary(ctx, range),
      getDailyBreakdown(ctx, range),
      getTopItems(ctx, range, TOP_ITEMS_LIMIT),
    ]);
    report = { summary, daily, top };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    failure =
      e.code === "VALIDATION" ? e.message : "The report could not be loaded. Please try again.";
  }

  const exportHref = `/reports/export?period=${period}&date=${date}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Report period" className="flex overflow-hidden rounded-lg border border-gray-300">
          {TABS.map((tab) => {
            const active = tab.period === period;
            return (
              <Link
                key={tab.period}
                href={`/reports?period=${tab.period}&date=${date}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center px-5 font-medium ${
                  active ? "bg-gray-900 text-white" : "bg-white text-gray-800 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <form method="get" action="/reports" className="flex items-end gap-2">
          <input type="hidden" name="period" value={period} />
          <div className="space-y-1">
            <label htmlFor="report-date" className="block text-sm font-medium">
              Date
            </label>
            <input
              id="report-date"
              type="date"
              name="date"
              required
              defaultValue={date}
              className="min-h-11 rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <button type="submit" className="min-h-11 rounded bg-black px-4 font-medium text-white">
            Show
          </button>
        </form>

        {/* A plain anchor: this is a file download, not a page to prefetch or navigate to. */}
        <a
          href={exportHref}
          className="inline-flex min-h-11 items-center rounded border border-gray-300 px-4 font-medium hover:bg-gray-50"
        >
          Export CSV
        </a>
      </div>

      <p className="text-sm text-gray-600">
        {range.from === range.to ? range.from : `${range.from} to ${range.to}`}
      </p>

      {failure && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {failure}
        </p>
      )}

      {report && <ReportBody report={report} />}
    </div>
  );
}

function ReportBody({ report }: { report: Report }) {
  const { summary, daily, top } = report;
  return (
    <>
      <section aria-labelledby="summary-heading" className="space-y-3">
        <h2 id="summary-heading" className="text-lg font-semibold">
          Summary
        </h2>
        <StatGrid>
          <StatCard label="Gross sales" value={formatPaise(summary.grossSalesPaise)} testId="stat-gross" />
          <StatCard label="Discounts" value={formatPaise(summary.discountPaise)} testId="stat-discounts" />
          <StatCard label="GST" value={formatPaise(summary.gstPaise)} testId="stat-gst" />
          <StatCard label="Net total" value={formatPaise(summary.totalPaise)} testId="stat-net-total" />
          <StatCard label="Bills" value={String(summary.billCount)} testId="stat-bills" />
          <StatCard label="Average bill" value={formatPaise(summary.avgBillPaise)} testId="stat-average" />
        </StatGrid>
      </section>

      <section aria-labelledby="split-heading" className="space-y-3">
        <h2 id="split-heading" className="text-lg font-semibold">
          Payment split
        </h2>
        <StatGrid>
          <StatCard label="Cash" value={formatPaise(summary.cashPaise)} testId="stat-cash" />
          <StatCard label="UPI" value={formatPaise(summary.upiPaise)} testId="stat-upi" />
        </StatGrid>
      </section>

      <section aria-labelledby="cancelled-heading" className="space-y-3">
        <h2 id="cancelled-heading" className="text-lg font-semibold">
          Cancelled bills
        </h2>
        <p className="text-sm text-gray-600">Cancelled bills are excluded from sales above.</p>
        <StatGrid>
          <StatCard label="Cancelled bills" value={String(summary.cancelledCount)} testId="stat-cancelled" />
          <StatCard label="Cancelled amount" value={formatPaise(summary.cancelledPaise)} testId="stat-cancelled-amount" />
        </StatGrid>
      </section>

      <section aria-labelledby="daily-heading" className="space-y-3">
        <h2 id="daily-heading" className="text-lg font-semibold">
          Sales by day
        </h2>
        {daily.length === 0 ? (
          <p role="status" className="text-sm text-gray-600">
            No sales in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Sales by day</caption>
              <thead className="border-b border-gray-200 text-gray-600">
                <tr>
                  <th scope="col" className={TH}>
                    Date
                  </th>
                  <th scope="col" className={THR}>
                    Bills
                  </th>
                  <th scope="col" className={THR}>
                    Cash
                  </th>
                  <th scope="col" className={THR}>
                    UPI
                  </th>
                  <th scope="col" className={THR}>
                    Discounts
                  </th>
                  <th scope="col" className={THR}>
                    GST
                  </th>
                  <th scope="col" className={THR}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.businessDate} className="border-b border-gray-100">
                    <th scope="row" className="py-1 pr-3 font-normal tabular-nums">
                      {d.businessDate}
                    </th>
                    <td className={TDR}>{d.billCount}</td>
                    <td className={TDR}>{formatPaise(d.cashPaise)}</td>
                    <td className={TDR}>{formatPaise(d.upiPaise)}</td>
                    <td className={TDR}>{formatPaise(d.discountPaise)}</td>
                    <td className={TDR}>{formatPaise(d.gstPaise)}</td>
                    <td className={TDR}>{formatPaise(d.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-gray-300 font-semibold">
                <tr>
                  <th scope="row" className="py-2 pr-3">
                    Total
                  </th>
                  <td className={TDR}>{summary.billCount}</td>
                  <td className={TDR}>{formatPaise(summary.cashPaise)}</td>
                  <td className={TDR}>{formatPaise(summary.upiPaise)}</td>
                  <td className={TDR}>{formatPaise(summary.discountPaise)}</td>
                  <td className={TDR}>{formatPaise(summary.gstPaise)}</td>
                  <td className={TDR}>{formatPaise(summary.totalPaise)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="top-heading" className="space-y-3">
        <h2 id="top-heading" className="text-lg font-semibold">
          Top items
        </h2>
        {top.length === 0 ? (
          <p role="status" className="text-sm text-gray-600">
            No items sold in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Top items</caption>
              <thead className="border-b border-gray-200 text-gray-600">
                <tr>
                  <th scope="col" className={TH}>
                    Item
                  </th>
                  <th scope="col" className={THR}>
                    Quantity
                  </th>
                  <th scope="col" className={THR}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {top.map((item) => (
                  <tr key={item.productName} className="border-b border-gray-100">
                    <th scope="row" className="py-1 pr-3 font-normal">
                      {item.productName}
                    </th>
                    <td className={TDR}>{item.quantity}</td>
                    <td className={TDR}>{formatPaise(item.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
