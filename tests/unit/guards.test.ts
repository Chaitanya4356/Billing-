import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/types";
import { assertRole } from "@/modules/auth/guards";

const owner: AuthContext = { shopId: "s1", userId: "u1", role: "OWNER" };
const cashier: AuthContext = { shopId: "s1", userId: "u2", role: "CASHIER" };

describe("assertRole", () => {
  it("throws FORBIDDEN for a cashier on ['OWNER']", () => {
    let err: unknown;
    try {
      assertRole(cashier, ["OWNER"]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("FORBIDDEN");
  });

  it("passes for an owner on ['OWNER']", () => {
    expect(() => assertRole(owner, ["OWNER"])).not.toThrow();
  });

  it("passes when the role is one of several allowed", () => {
    expect(() => assertRole(cashier, ["OWNER", "CASHIER"])).not.toThrow();
  });
});
