import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { DETAIL_MAX_CHARS, metaPairs, shortId, stringifyMetaValue } from "@/modules/audit/format";
import { AUDIT_ACTION_LABELS, auditActionLabel } from "@/modules/audit/labels";
import { parseAuditParams } from "@/modules/audit/params";

describe("parseAuditParams", () => {
  it("returns the defaults when nothing is given", () => {
    expect(parseAuditParams({})).toEqual({ from: "", to: "", action: "", page: 1, invalid: false });
    expect(parseAuditParams({ from: "", to: "", action: "", page: "" }).invalid).toBe(false);
    expect(parseAuditParams({ from: null, to: undefined })).toMatchObject({ from: "", to: "", invalid: false });
  });

  it("accepts real dates, a known action and a page", () => {
    expect(parseAuditParams({ from: "2026-11-01", to: "2026-11-10", action: "BILL_CANCELLED", page: "3" })).toEqual({
      from: "2026-11-01",
      to: "2026-11-10",
      action: "BILL_CANCELLED",
      page: 3,
      invalid: false,
    });
  });

  it("allows from equal to to, and only one of them", () => {
    expect(parseAuditParams({ from: "2026-11-10", to: "2026-11-10" }).invalid).toBe(false);
    expect(parseAuditParams({ from: "2026-11-10" })).toMatchObject({ from: "2026-11-10", to: "" });
  });

  it("drops bad dates and flags them", () => {
    for (const bad of ["garbage", "2026-02-30", "2026-13-01", "10-11-2026", "2026-1-1", "2026-11-10T00:00"]) {
      expect(parseAuditParams({ from: bad })).toMatchObject({ from: "", invalid: true });
      expect(parseAuditParams({ to: bad })).toMatchObject({ to: "", invalid: true });
    }
  });

  it("drops both dates when from is after to", () => {
    expect(parseAuditParams({ from: "2026-11-11", to: "2026-11-10" })).toMatchObject({ from: "", to: "", invalid: true });
  });

  it("allow-lists the action", () => {
    for (const a of AUDIT_ACTIONS) expect(parseAuditParams({ action: a }).action).toBe(a);
    for (const bad of ["NOPE", "bill_created", "constructor", "__proto__", "BILL_CREATED "]) {
      const r = parseAuditParams({ action: bad });
      // Surrounding whitespace is trimmed, so only a genuinely unknown value is rejected.
      if (bad.trim() === "BILL_CREATED") expect(r.action).toBe("BILL_CREATED");
      else expect(r).toMatchObject({ action: "", invalid: true });
    }
  });

  it("clamps the page to 1 and flags junk", () => {
    for (const bad of ["0", "-1", "abc", "1.5", "1e3", "99999999999999999999", "NaN"]) {
      expect(parseAuditParams({ page: bad })).toMatchObject({ page: 1, invalid: true });
    }
    expect(parseAuditParams({ page: "1" })).toMatchObject({ page: 1, invalid: false });
  });

  it("uses the first value of a repeated param", () => {
    expect(parseAuditParams({ action: ["BILL_CREATED", "x"], page: ["2", "9"] })).toMatchObject({
      action: "BILL_CREATED",
      page: 2,
      invalid: false,
    });
  });
});

describe("audit action labels", () => {
  it("has a non-empty, unique label for every action and no extras", () => {
    expect(Object.keys(AUDIT_ACTION_LABELS).sort()).toEqual([...AUDIT_ACTIONS].sort());
    const labels = AUDIT_ACTIONS.map((a) => AUDIT_ACTION_LABELS[a]);
    for (const l of labels) expect(l.trim()).not.toBe("");
    expect(new Set(labels).size).toBe(AUDIT_ACTIONS.length);
  });

  it("reads naturally", () => {
    expect(auditActionLabel("BILL_CANCELLED")).toBe("Bill cancelled");
    expect(auditActionLabel("LOGIN_FAILED")).toBe("Login failed");
  });

  it("falls back to the raw value for an unknown action", () => {
    expect(auditActionLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("audit meta formatting", () => {
  it("stringifies each kind of value", () => {
    expect(stringifyMetaValue("x")).toBe("x");
    expect(stringifyMetaValue(1500)).toBe("1500");
    expect(stringifyMetaValue(true)).toBe("true");
    expect(stringifyMetaValue(null)).toBe("null");
    expect(stringifyMetaValue(["a", "b", 3])).toBe("a, b, 3");
    expect(stringifyMetaValue({ a: 1, b: [2] })).toBe('{"a":1,"b":[2]}');
    expect(stringifyMetaValue([{ a: 1 }, "z"])).toBe('{"a":1}, z');
  });

  it("does not throw on odd values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(stringifyMetaValue(cyclic)).toBe("[unreadable]");
    expect(stringifyMetaValue(undefined)).toBe("");
  });

  it("keeps markup as plain text (escaping is React's job) and truncates long values", () => {
    const pairs = metaPairs({ reason: "<script>alert(1)</script>", long: "x".repeat(500) });
    expect(pairs[0]).toMatchObject({ key: "reason", text: "<script>alert(1)</script>", truncated: false });
    expect(pairs[1].truncated).toBe(true);
    expect(pairs[1].text).toHaveLength(DETAIL_MAX_CHARS);
    expect(pairs[1].text.endsWith("…")).toBe(true);
    expect(pairs[1].full).toHaveLength(500);
  });

  it("returns no pairs for empty meta and shortens ids", () => {
    expect(metaPairs({})).toEqual([]);
    expect(shortId("0123456789abcdef")).toBe("01234567");
    expect(shortId(null)).toBe("");
  });
});
