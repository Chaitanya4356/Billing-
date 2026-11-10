import { describe, expect, it, vi } from "vitest";
import { AppError, runAction } from "@/lib/errors";

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
