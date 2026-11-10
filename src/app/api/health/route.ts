import { sql } from "drizzle-orm";

// Public uptime-monitor endpoint: never cached, never touches the session.
export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 3000;

const headers = { "Cache-Control": "no-store" };

/** Runs `select 1` through the shared pool; rejects if it takes longer than the timeout. */
async function pingDatabase(): Promise<void> {
  // Lazy import: the pool (and DATABASE_URL validation) is only touched at request time, never during `next build`.
  const { db } = await import("@/db/client");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health check timed out")), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([db.execute(sql`select 1`), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** GET /api/health: 200 {"status":"ok"} when the database answers, else 503 {"status":"unavailable"}. */
export async function GET(): Promise<Response> {
  try {
    await pingDatabase();
    return Response.json({ status: "ok" }, { status: 200, headers });
  } catch {
    // Deliberately no details (messages can contain hostnames or credentials).
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
