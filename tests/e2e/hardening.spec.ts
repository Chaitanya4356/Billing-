import { expect, test } from "@playwright/test";
import { resetAndSeed } from "./helpers";

test.beforeAll(async () => {
  await resetAndSeed();
});

test("GET /api/health is public, answers ok and is never cached", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("pages and the health endpoint carry the security headers", async ({ request }) => {
  for (const path of ["/login", "/api/health"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["referrer-policy"], path).toBe("same-origin");
    // Dev mode: no HSTS (localhost must not be pinned to HTTPS) and no framework banner.
    expect(headers["strict-transport-security"], path).toBeUndefined();
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});

test("the report CSV still rejects anonymous requests", async ({ request }) => {
  const response = await request.get("/reports/export?period=day", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
});
