import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "../helpers/assert-test-db";

describe("assertTestDatabaseUrl", () => {
  it("accepts a database name ending in _test", () => {
    expect(() => assertTestDatabaseUrl("postgres://u:p@localhost:5432/billing_test")).not.toThrow();
  });

  it("accepts a _test database with a query string", () => {
    expect(() =>
      assertTestDatabaseUrl("postgres://u:p@localhost:5432/billing_test?sslmode=disable"),
    ).not.toThrow();
  });

  it("rejects a non-test database", () => {
    expect(() => assertTestDatabaseUrl("postgres://u:p@localhost:5432/billing")).toThrow(/_test/);
  });

  it("rejects a non-test database with a query string", () => {
    expect(() =>
      assertTestDatabaseUrl("postgres://u:p@localhost:5432/billing?sslmode=disable"),
    ).toThrow(/_test/);
  });

  it("rejects an unparsable URL", () => {
    expect(() => assertTestDatabaseUrl("not a url")).toThrow();
  });
});
