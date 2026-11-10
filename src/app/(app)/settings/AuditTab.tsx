import Link from "next/link";
import { formatDateTimeIST } from "@/lib/time";
import type { AuthContext } from "@/lib/types";
import { AppError } from "@/lib/errors";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { metaPairs, shortId } from "@/modules/audit/format";
import { auditActionLabel } from "@/modules/audit/labels";
import { AUDIT_PAGE_SIZE, parseAuditParams, type AuditParams } from "@/modules/audit/params";
import { listAudit, type AuditRow } from "@/modules/audit/service";

type SearchParams = { [key: string]: string | string[] | undefined };

const INPUT = "min-h-11 w-full rounded border border-gray-300 px-3 py-2";
const LINK_BUTTON = "inline-flex min-h-11 items-center rounded border border-gray-300 px-4 font-medium hover:bg-gray-50";
const DISABLED_BUTTON = "inline-flex min-h-11 items-center rounded border border-gray-200 px-4 font-medium text-gray-400";

function auditUrl(p: AuditParams, page: number): string {
  const qs = new URLSearchParams({ tab: "audit" });
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  if (p.action) qs.set("action", p.action);
  if (page > 1) qs.set("page", String(page));
  return `/settings?${qs.toString()}`;
}

/**
 * Read-only audit log: filters (a plain GET form, kept in the URL), the table
 * and Prev/Next paging. Rendered on the server; invalid URL values fall back
 * to defaults and a service error is shown instead of crashing the page.
 */
export async function AuditTab({ ctx, searchParams }: { ctx: AuthContext; searchParams: SearchParams }) {
  const params = parseAuditParams(searchParams);

  let rows: AuditRow[] = [];
  let total = 0;
  let error: string | null = null;
  try {
    ({ rows, total } = await listAudit(ctx, {
      from: params.from || undefined,
      to: params.to || undefined,
      action: params.action || undefined,
      page: params.page,
      pageSize: AUDIT_PAGE_SIZE,
    }));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }

  const start = (params.page - 1) * AUDIT_PAGE_SIZE + 1;
  const range = rows.length === 0 ? `0 of ${total}` : `${start}–${start + rows.length - 1} of ${total}`;
  const hasPrev = params.page > 1;
  const hasNext = params.page * AUDIT_PAGE_SIZE < total;

  return (
    <div className="space-y-4">
      <form method="get" action="/settings" aria-label="Audit log filters" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="audit" />
        <div className="space-y-1">
          <label htmlFor="audit-from" className="block text-sm font-medium">
            From date
          </label>
          <input id="audit-from" name="from" type="date" defaultValue={params.from} className={INPUT} />
        </div>
        <div className="space-y-1">
          <label htmlFor="audit-to" className="block text-sm font-medium">
            To date
          </label>
          <input id="audit-to" name="to" type="date" defaultValue={params.to} className={INPUT} />
        </div>
        <div className="space-y-1">
          <label htmlFor="audit-action" className="block text-sm font-medium">
            Action
          </label>
          <select id="audit-action" name="action" defaultValue={params.action} className={INPUT}>
            <option value="">All</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {auditActionLabel(a)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded bg-black px-4 font-medium text-white">
          Apply filters
        </button>
        <Link href="/settings?tab=audit" className={LINK_BUTTON}>
          Clear
        </Link>
      </form>

      {params.invalid && !error && (
        <p role="status" className="text-sm text-gray-600">
          Some filters in the address were not valid and were ignored.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p role="status" className="py-6 text-sm text-gray-600">
          {error ? "The audit log could not be shown." : "No audit entries found."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Audit log, newest first</caption>
            <thead className="border-b border-gray-200 text-gray-600">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Time
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  User
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Action
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Entity
                </th>
                <th scope="col" className="py-2 font-medium">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-action={row.action} className="border-b border-gray-100 align-top">
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{formatDateTimeIST(row.createdAt)}</td>
                  <td className="py-2 pr-3">{row.userName ?? "—"}</td>
                  <td className="py-2 pr-3 font-medium">{auditActionLabel(row.action)}</td>
                  <td className="py-2 pr-3">
                    {row.entityType}
                    {row.entityId ? (
                      <span title={row.entityId} className="ml-1 font-mono text-xs text-gray-600">
                        {shortId(row.entityId)}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <Details meta={row.meta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Audit log pages" className="flex items-center justify-between gap-3">
        {hasPrev ? (
          <Link href={auditUrl(params, params.page - 1)} rel="prev" className={LINK_BUTTON}>
            Prev
          </Link>
        ) : (
          <span aria-disabled="true" className={DISABLED_BUTTON}>
            Prev
          </span>
        )}
        <span data-testid="audit-page-range" aria-live="polite" className="text-sm tabular-nums">
          {range}
        </span>
        {hasNext ? (
          <Link href={auditUrl(params, params.page + 1)} rel="next" className={LINK_BUTTON}>
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className={DISABLED_BUTTON}>
            Next
          </span>
        )}
      </nav>
    </div>
  );
}

function Details({ meta }: { meta: Record<string, unknown> }) {
  const pairs = metaPairs(meta);
  if (pairs.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {pairs.map((p) => (
        <span key={p.key} title={p.truncated ? p.full : undefined} className="break-all">
          <span className="text-gray-600">{p.key}:</span> {p.text}
        </span>
      ))}
    </span>
  );
}
