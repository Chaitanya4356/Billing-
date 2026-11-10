"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { formatPaise } from "@/lib/money";
import { formatDateTimeIST } from "@/lib/time";
import type { Role } from "@/lib/types";
import type { BillListRow } from "@/modules/bills/service";
import { BillDrawer } from "./BillDrawer";
import { StatusBadge } from "./StatusBadge";

export interface BillsFilters {
  /** Token or bill number text. */
  q: string;
  /** YYYY-MM-DD, owner only; "" = all dates. */
  date: string;
  status: "" | "COMPLETED" | "CANCELLED";
  method: "" | "CASH" | "UPI";
  page: number;
}

const INPUT = "min-h-11 w-full rounded border border-gray-300 px-3 py-2";

function toUrl(f: BillsFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.date) p.set("date", f.date);
  if (f.status) p.set("status", f.status);
  if (f.method) p.set("method", f.method);
  if (f.page > 1) p.set("page", String(f.page));
  const qs = p.toString();
  return qs ? `/bills?${qs}` : "/bills";
}

/**
 * Bill history: filters (kept in the URL, the list is rendered by the server),
 * the paged table and the detail drawer.
 */
export function BillsTable({
  role,
  cashierCanCancel,
  filters,
  rows,
  total,
  pageSize,
}: {
  role: Role;
  cashierCanCancel: boolean;
  filters: BillsFilters;
  rows: BillListRow[];
  total: number;
  pageSize: number;
}) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();

  // The text boxes are editable; follow the URL whenever it changes (back/forward, Clear).
  const filtersKey = `${filters.q}|${filters.date}`;
  const [seenKey, setSeenKey] = useState(filtersKey);
  const [q, setQ] = useState(filters.q);
  const [date, setDate] = useState(filters.date);
  if (seenKey !== filtersKey) {
    setSeenKey(filtersKey);
    setQ(filters.q);
    setDate(filters.date);
  }

  const [selected, setSelected] = useState<{ id: string; billNumberDisplay: string } | null>(null);
  const [cancelledIds, setCancelledIds] = useState<ReadonlySet<string>>(new Set());
  const openerRef = useRef<HTMLElement | null>(null);

  // The filters as last asked for. Several changes can be made before the server
  // answers the first, so each change builds on this, not on the (older) props.
  const latest = useRef(filters);
  useEffect(() => {
    if (!navigating) latest.current = filters;
  }, [filters, navigating]);

  /** Applies a change on top of the latest filters; the page restarts at 1 unless given. */
  function update(patch: Partial<BillsFilters>) {
    const next = { ...latest.current, page: 1, ...patch };
    latest.current = next;
    startTransition(() => router.push(toUrl(next)));
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    update({ q: q.trim() });
  }

  function open(row: BillListRow, trigger: HTMLElement | null) {
    openerRef.current = trigger;
    setSelected({ id: row.id, billNumberDisplay: row.billNumberDisplay });
  }

  function close() {
    setSelected(null);
    // Back to the row that opened the drawer.
    openerRef.current?.focus();
  }

  const start = (filters.page - 1) * pageSize + 1;
  const end = start + rows.length - 1;
  const range = rows.length === 0 ? `0 of ${total}` : `${start}–${end} of ${total}`;
  const hasPrev = filters.page > 1;
  const hasNext = filters.page * pageSize < total;

  return (
    <>
      <form role="search" onSubmit={onSearch} className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor="bills-search" className="block text-sm font-medium">
            Search token or bill number
          </label>
          <input
            id="bills-search"
            type="search"
            value={q}
            maxLength={40}
            onChange={(e) => setQ(e.target.value)}
            className={INPUT}
          />
        </div>
        {role === "OWNER" && (
          <div className="space-y-1">
            <label htmlFor="bills-date" className="block text-sm font-medium">
              Date
            </label>
            <input
              id="bills-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                update({ date: e.target.value });
              }}
              className={INPUT}
            />
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="bills-status" className="block text-sm font-medium">
            Status
          </label>
          <select
            id="bills-status"
            value={filters.status}
            onChange={(e) => update({ status: e.target.value as BillsFilters["status"] })}
            className={INPUT}
          >
            <option value="">All</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="bills-method" className="block text-sm font-medium">
            Payment method
          </label>
          <select
            id="bills-method"
            value={filters.method}
            onChange={(e) => update({ method: e.target.value as BillsFilters["method"] })}
            className={INPUT}
          >
            <option value="">All</option>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded bg-black px-4 font-medium text-white">
          Search
        </button>
      </form>

      {role === "CASHIER" && <p className="text-sm text-gray-600">Showing today&apos;s bills.</p>}

      <div aria-busy={navigating} className={navigating ? "opacity-60" : undefined}>
        {rows.length === 0 ? (
          <p role="status" className="py-6 text-sm text-gray-600">
            No bills found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="Bills" className="w-full text-left text-sm">
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
                {rows.map((row) => {
                  const status = cancelledIds.has(row.id) ? "CANCELLED" : row.status;
                  return (
                    <tr
                      key={row.id}
                      onClick={(e) => open(row, e.currentTarget.querySelector("button"))}
                      className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-1 pr-3">
                        <button
                          type="button"
                          aria-label={`Open bill ${row.billNumberDisplay}`}
                          className="min-h-11 font-medium tabular-nums underline"
                        >
                          {row.billNumberDisplay}
                        </button>
                      </td>
                      <td className="py-1 pr-3 tabular-nums">{row.tokenNumber}</td>
                      <td className="py-1 pr-3">{formatDateTimeIST(new Date(row.createdAt))}</td>
                      <td className="py-1 pr-3">{row.paymentMethod === "CASH" ? "Cash" : "UPI"}</td>
                      <td className="py-1 pr-3">
                        <StatusBadge status={status} />
                      </td>
                      <td className="py-1 text-right tabular-nums">{formatPaise(row.totalPaise)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <nav aria-label="Pages" className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={!hasPrev}
          onClick={() => update({ page: latest.current.page - 1 })}
          className="min-h-11 rounded border border-gray-300 px-4 font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Prev
        </button>
        <span data-testid="page-range" aria-live="polite" className="text-sm tabular-nums">
          {range}
        </span>
        <button
          type="button"
          disabled={!hasNext}
          onClick={() => update({ page: latest.current.page + 1 })}
          className="min-h-11 rounded border border-gray-300 px-4 font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Next
        </button>
      </nav>

      {selected && (
        <BillDrawer
          key={selected.id}
          billId={selected.id}
          billNumberDisplay={selected.billNumberDisplay}
          role={role}
          cashierCanCancel={cashierCanCancel}
          onClose={close}
          onCancelled={(id) => {
            setCancelledIds((prev) => new Set(prev).add(id));
            router.refresh();
          }}
        />
      )}
    </>
  );
}
