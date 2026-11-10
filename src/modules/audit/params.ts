import { isRealDate } from "@/modules/reports/params";
import { isAuditAction, type AuditAction } from "./actions";

export const AUDIT_PAGE_SIZE = 50;

export interface AuditParams {
  /** Valid YYYY-MM-DD or "". */
  from: string;
  /** Valid YYYY-MM-DD or "". */
  to: string;
  /** An allowed action or "". */
  action: AuditAction | "";
  /** Always >= 1. */
  page: number;
  /** True when something was given but dropped (bad date, unknown action, from after to, bad page). */
  invalid: boolean;
}

type Raw = string | string[] | undefined | null;

function one(value: Raw): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

/**
 * Reads the audit filters from URL search params without ever throwing: dates
 * must be real YYYY-MM-DD dates, the action one of the known actions, the page
 * a whole number >= 1. Anything else falls back to the default and is flagged.
 */
export function parseAuditParams(params: { from?: Raw; to?: Raw; action?: Raw; page?: Raw }): AuditParams {
  let invalid = false;

  const rawFrom = one(params.from);
  const rawTo = one(params.to);
  const rawAction = one(params.action);
  const rawPage = one(params.page);

  let from = "";
  if (rawFrom) {
    if (isRealDate(rawFrom)) from = rawFrom;
    else invalid = true;
  }
  let to = "";
  if (rawTo) {
    if (isRealDate(rawTo)) to = rawTo;
    else invalid = true;
  }
  if (from && to && from > to) {
    from = "";
    to = "";
    invalid = true;
  }

  let action: AuditAction | "" = "";
  if (rawAction) {
    if (isAuditAction(rawAction)) action = rawAction;
    else invalid = true;
  }

  let page = 1;
  if (rawPage) {
    const n = /^\d{1,9}$/.test(rawPage) ? Number(rawPage) : NaN;
    if (Number.isSafeInteger(n) && n >= 1) page = n;
    else invalid = true;
  }

  return { from, to, action, page, invalid };
}
