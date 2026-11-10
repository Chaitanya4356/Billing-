export interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * Response headers applied to every route (see next.config.ts).
 * HSTS is production-only so that localhost is never pinned to HTTPS.
 * There is deliberately no Content-Security-Policy in v1: receipts are
 * rendered into srcdoc iframes with an inline style block.
 */
export function securityHeaders(nodeEnv: string): HeaderEntry[] {
  const headers: HeaderEntry[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "same-origin" },
  ];
  if (nodeEnv === "production") {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}
