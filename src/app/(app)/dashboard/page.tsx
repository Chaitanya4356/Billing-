import type { Metadata } from "next";
import Link from "next/link";
import { formatPaise } from "@/lib/money";
import { formatDateTimeIST } from "@/lib/time";
import { requirePageContext } from "@/modules/auth/page-guard";
import { getDashboard } from "@/modules/reports/service";
import { StatusBadge } from "../bills/StatusBadge";
import { StatCard, StatGrid } from "../stat-card";

export const metadata: Metadata = { title: "Dashboard · Billing" };

export default async function DashboardPage() {
  const ctx = await requirePageContext(["OWNER"]);
  const { today, recent } = await getDashboard(ctx);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      <section aria-labelledby="today-heading" className="space-y-3">
        <h2 id="today-heading" className="text-lg font-semibold">
          Today
        </h2>
        <StatGrid>
          <StatCard label="Total sales" value={formatPaise(today.totalPaise)} testId="stat-total" />
          <StatCard label="Bills" value={String(today.billCount)} testId="stat-bills" />
          <StatCard label="Cash" value={formatPaise(today.cashPaise)} testId="stat-cash" />
          <StatCard label="UPI" value={formatPaise(today.upiPaise)} testId="stat-upi" />
          <StatCard
            label="Cancelled bills"
            value={String(today.cancelledCount)}
            testId="stat-cancelled"
            note="Not counted in sales"
          />
          <StatCard label="Cancelled amount" value={formatPaise(today.cancelledPaise)} testId="stat-cancelled-amount" />
        </StatGrid>
      </section>

      <section aria-labelledby="recent-heading" className="space-y-3">
        <h2 id="recent-heading" className="text-lg font-semibold">
          Recent bills
        </h2>
        {recent.length === 0 ? (
          <p className="py-4 text-sm text-gray-600">No bills yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Recent bills</caption>
              <thead className="border-b border-gray-200 text-gray-600">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Bill number
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Token
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Date and time
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Method
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map((bill) => (
                  <tr key={bill.id} className="border-b border-gray-100">
                    <td className="py-1 pr-3">
                      <Link
                        href={`/bills?q=${encodeURIComponent(bill.billNumberDisplay)}`}
                        className="inline-flex min-h-11 items-center font-medium tabular-nums underline"
                      >
                        {bill.billNumberDisplay}
                      </Link>
                    </td>
                    <td className="py-1 pr-3 tabular-nums">{bill.tokenNumber}</td>
                    <td className="py-1 pr-3">{formatDateTimeIST(new Date(bill.createdAt))}</td>
                    <td className="py-1 pr-3">{bill.paymentMethod === "CASH" ? "Cash" : "UPI"}</td>
                    <td className="py-1 pr-3">
                      <StatusBadge status={bill.status} />
                    </td>
                    <td className="py-1 text-right tabular-nums">{formatPaise(bill.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
