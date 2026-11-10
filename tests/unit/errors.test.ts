import { describe, expect, it, vi } from "vitest";
import { AppError, describeError, runAction } from "@/lib/errors";

describe("AppError", () => {
  it("carries code, message and details", () => {
    const e = new AppError("NOT_FOUND", "missing", { id: 1 });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("missing");
    expect(e.details).toEqual({ id: 1 });
  });
});

describe("runAction", () => {
  it("returns ok result on success", async () => {
    expect(await runAction(async () => 42)).toEqual({ ok: true, data: 42 });
  });

  it("maps AppError to its code and message", async () => {
    const r = await runAction(async () => {
      throw new AppError("FORBIDDEN", "nope");
    });
    expect(r).toEqual({ ok: false, error: { code: "FORBIDDEN", message: "nope" } });
  });

  it("maps unknown errors to INTERNAL without leaking the message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runAction(async () => {
      throw new Error("secret db password");
    });
    expect(r).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong" },
    });
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

const SECRET_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";
const SECRET_PHONE = "9876543210";

/** A drizzle-style query failure: the SQL and bound parameters in the message, the pg error as `cause`. */
function drizzleLikeError(): Error {
  const pgError = Object.assign(new Error(`duplicate key value violates unique constraint (${SECRET_PHONE})`), {
    name: "DatabaseError",
    code: "23505",
    detail: `Key (phone)=(${SECRET_PHONE}) already exists.`,
  });
  const e = new Error(
    `Failed query: insert into "users" ("password_hash", "phone") values ($1, $2)
params: ${SECRET_HASH},${SECRET_PHONE}`,
    { cause: pgError },
  );
  e.name = "DrizzleQueryError";
  return e;
}

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .flat()
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a, (_k, v) => (v instanceof Error ? { ...v, message: v.message, stack: v.stack } : v))))
    .join(" ");
}

describe("runAction logging", () => {
  it("logs only the error name and the Postgres code, never the message, parameters or stack", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runAction(async () => {
      throw drizzleLikeError();
    });
    expect(r).toEqual({ ok: false, error: { code: "INTERNAL", message: "Something went wrong" } });
    expect(spy).toHaveBeenCalledTimes(1);
    const text = loggedText(spy);
    expect(text).toContain("DrizzleQueryError");
    expect(text).toContain("23505");
    expect(text).not.toContain("argon2id");
    expect(text).not.toContain(SECRET_PHONE);
    expect(text).not.toContain("Failed query");
    expect(text).not.toContain("at ");
    spy.mockRestore();
  });
});

describe("describeError", () => {
  it("returns the name and the first code found along the cause chain", () => {
    expect(describeError(drizzleLikeError())).toEqual({ name: "DrizzleQueryError", code: "23505" });
  });

  it("uses a code on the error itself", () => {
    const e = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" });
    expect(describeError(e)).toEqual({ name: "Error", code: "ECONNREFUSED" });
  });

  it("omits the code when there is none", () => {
    expect(describeError(new TypeError("x is undefined"))).toEqual({ name: "TypeError" });
  });

  it("handles non-Error throwables without echoing them", () => {
    expect(describeError(`secret ${SECRET_PHONE}`)).toEqual({ name: "string" });
    expect(describeError(null)).toEqual({ name: "null" });
    expect(describeError({ code: "23505", message: SECRET_HASH })).toEqual({ name: "object", code: "23505" });
  });

  it("ignores codes and names that are not short identifiers", () => {
    const e = Object.assign(new Error("m"), { name: `bad name ${SECRET_PHONE}`, code: `x ${SECRET_PHONE}` });
    expect(describeError(e)).toEqual({ name: "Error" });
  });

  it("stops on cyclic cause chains", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(describeError(a)).toEqual({ name: "Error" });
  });
});
