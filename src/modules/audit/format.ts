/** Longest value shown in the details column before it is cut (the full text stays in the title attribute). */
export const DETAIL_MAX_CHARS = 80;

/** A meta value as short text: arrays joined, objects as compact JSON, null as "null". Never throws. */
export function stringifyMetaValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map((v) => (v !== null && typeof v === "object" ? safeJson(v) : stringifyMetaValue(v))).join(", ");
  return safeJson(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unreadable]";
  }
}

export interface MetaPair {
  key: string;
  /** Full text of the value. */
  full: string;
  /** The value, cut to DETAIL_MAX_CHARS with an ellipsis when longer. */
  text: string;
  truncated: boolean;
}

/** `meta` as ordered key/value pairs for display; long values are truncated. */
export function metaPairs(meta: Record<string, unknown>): MetaPair[] {
  return Object.entries(meta).map(([key, value]) => {
    const full = stringifyMetaValue(value);
    const truncated = full.length > DETAIL_MAX_CHARS;
    return { key, full, text: truncated ? `${full.slice(0, DETAIL_MAX_CHARS - 1)}…` : full, truncated };
  });
}

/** First 8 characters of an id, for a compact entity column. */
export function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "";
}
