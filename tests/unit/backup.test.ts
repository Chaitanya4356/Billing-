import { describe, expect, it } from "vitest";
import {
  backupFileName,
  buildPgCommand,
  compareCounts,
  databaseUrlWithDatabase,
  newestBackup,
  parseDatabaseUrl,
  quoteIdent,
  resolveToolMode,
  selectExpired,
  validateContainerName,
} from "../../scripts/lib/backup-utils";

describe("backupFileName", () => {
  it("formats a UTC timestamp", () => {
    expect(backupFileName(new Date("2026-11-10T03:05:00Z"))).toBe("billing-20261110-0305.dump");
  });

  it("zero-pads single-digit months, days, hours and minutes", () => {
    expect(backupFileName(new Date("2026-02-03T04:05:00Z"))).toBe("billing-20260203-0405.dump");
  });

  it("uses UTC near a day boundary", () => {
    expect(backupFileName(new Date("2026-12-31T23:59:59Z"))).toBe("billing-20261231-2359.dump");
    expect(backupFileName(new Date("2027-01-01T00:00:00Z"))).toBe("billing-20270101-0000.dump");
    // 01:30 at +05:30 is still the previous UTC day.
    expect(backupFileName(new Date("2026-11-10T01:30:00+05:30"))).toBe("billing-20261109-2000.dump");
  });
});

describe("selectExpired", () => {
  const now = new Date("2026-11-10T12:00:00Z");

  it("keeps files from the 30-day boundary day and newer, expires older ones", () => {
    const files = [
      "billing-20261110-0305.dump",
      "billing-20261101-0305.dump",
      "billing-20261011-0000.dump", // 30 days earlier (boundary): kept
      "billing-20261009-0000.dump", // expired
    ];
    expect(selectExpired(files, now)).toEqual(["billing-20261009-0000.dump"]);
  });

  it("expires the day just before the boundary", () => {
    const files = ["billing-20261010-2359.dump", "billing-20261110-0305.dump"];
    expect(selectExpired(files, now)).toEqual(["billing-20261010-2359.dump"]);
  });

  it("ignores names that do not match the pattern", () => {
    const files = ["notes.txt", "billing-bad.dump", "billing-20260101-0000.dump.partial", "billing-20261110-0305.dump"];
    expect(selectExpired(files, now)).toEqual([]);
    expect(selectExpired([...files, "billing-20260101-0000.dump"], now)).toEqual(["billing-20260101-0000.dump"]);
  });

  it("ignores impossible dates", () => {
    expect(selectExpired(["billing-20261399-0000.dump", "billing-20261110-0305.dump"], now)).toEqual([]);
  });

  it("honours a custom keepDays", () => {
    const files = ["billing-20261110-0305.dump", "billing-20261105-0000.dump", "billing-20261101-0000.dump"];
    expect(selectExpired(files, now, 7)).toEqual(["billing-20261101-0000.dump"]);
    expect(selectExpired(files, now, 3)).toEqual(["billing-20261105-0000.dump", "billing-20261101-0000.dump"]);
  });

  it("never returns the newest backup even when every file is old", () => {
    const files = ["billing-20250101-0000.dump", "billing-20250301-0000.dump", "billing-20250201-0000.dump"];
    expect(selectExpired(files, now)).toEqual(["billing-20250101-0000.dump", "billing-20250201-0000.dump"]);
    expect(selectExpired(["billing-20250101-0000.dump"], now)).toEqual([]);
  });
});

describe("newestBackup", () => {
  it("returns the newest matching file, or undefined", () => {
    expect(
      newestBackup(["billing-20261101-0305.dump", "notes.txt", "billing-20261110-0305.dump", "billing-20261109-2359.dump"]),
    ).toBe("billing-20261110-0305.dump");
    expect(newestBackup(["notes.txt"])).toBeUndefined();
    expect(newestBackup([])).toBeUndefined();
  });
});

describe("parseDatabaseUrl", () => {
  it("parses all parts", () => {
    expect(parseDatabaseUrl("postgres://alice:secret@db.example.com:6543/billing")).toEqual({
      host: "db.example.com",
      port: 6543,
      user: "alice",
      password: "secret",
      database: "billing",
    });
  });

  it("decodes percent-encoded special characters", () => {
    const c = parseDatabaseUrl("postgresql://us%40er:p%40ss%3Aw%2Ford%23%25@localhost/billing");
    expect(c.user).toBe("us@er");
    expect(c.password).toBe("p@ss:w/ord#%");
  });

  it("defaults the port to 5432", () => {
    expect(parseDatabaseUrl("postgres://postgres:postgres@localhost/billing").port).toBe(5432);
  });

  it("rejects a missing database", () => {
    expect(() => parseDatabaseUrl("postgres://postgres:postgres@localhost:5432")).toThrow(/database/i);
    expect(() => parseDatabaseUrl("postgres://postgres:postgres@localhost:5432/")).toThrow(/database/i);
  });

  it("rejects invalid input without echoing it", () => {
    expect(() => parseDatabaseUrl("not a url")).toThrow(/DATABASE_URL/);
    expect(() => parseDatabaseUrl("mysql://u:p@h/db")).toThrow(/postgres/i);
    expect(() => parseDatabaseUrl("postgres://localhost/billing")).toThrow(/user/i);
    try {
      parseDatabaseUrl("garbage-with-secret-hunter2");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("hunter2");
    }
  });
});

describe("databaseUrlWithDatabase", () => {
  it("replaces only the database name", () => {
    expect(databaseUrlWithDatabase("postgres://u:p%40x@h:5433/billing?sslmode=require", "scratch")).toBe(
      "postgres://u:p%40x@h:5433/scratch?sslmode=require",
    );
  });
});

describe("quoteIdent", () => {
  it("quotes and escapes identifiers", () => {
    expect(quoteIdent("bills")).toBe('"bills"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });
});

describe("validateContainerName", () => {
  it("accepts valid names", () => {
    for (const n of ["billing-db", "db1", "my_db.v2", "A"]) {
      expect(validateContainerName(n)).toBe(n);
    }
  });

  it("rejects the protected container, empty names and unsafe characters", () => {
    for (const n of ["misthi-foods-db", "", "has space", "a;b", "-leading", "a$(x)", "a/b", "x\ny"]) {
      expect(() => validateContainerName(n)).toThrow();
    }
  });
});

describe("resolveToolMode", () => {
  it("defaults to host tools", () => {
    expect(resolveToolMode({})).toEqual({ kind: "host", binDir: undefined });
    expect(resolveToolMode({ PG_BIN_DIR: "/usr/lib/postgresql/16/bin" })).toEqual({
      kind: "host",
      binDir: "/usr/lib/postgresql/16/bin",
    });
  });

  it("selects docker mode from BACKUP_DOCKER_CONTAINER and validates it", () => {
    expect(resolveToolMode({ BACKUP_DOCKER_CONTAINER: "billing-db" })).toEqual({ kind: "docker", container: "billing-db" });
    expect(() => resolveToolMode({ BACKUP_DOCKER_CONTAINER: "misthi-foods-db" })).toThrow();
    expect(() => resolveToolMode({ BACKUP_DOCKER_CONTAINER: "a b" })).toThrow();
  });

  it("treats an empty/blank variable as unset", () => {
    expect(resolveToolMode({ BACKUP_DOCKER_CONTAINER: "  ", PG_BIN_DIR: "" })).toEqual({ kind: "host", binDir: undefined });
  });
});

describe("buildPgCommand", () => {
  const conn = { host: "db.example.com", port: 6543, user: "alice", password: "s3cr3t-pw", database: "billing" };

  it("builds a host-mode pg_dump command", () => {
    const cmd = buildPgCommand({ kind: "host" }, "pg_dump", ["-Fc", "-d", "billing"], conn);
    expect(cmd.command).toBe("pg_dump");
    expect(cmd.args).toEqual(["-h", "db.example.com", "-p", "6543", "-U", "alice", "-w", "-Fc", "-d", "billing"]);
    expect(cmd.env).toEqual({ PGPASSWORD: "s3cr3t-pw" });
  });

  it("uses PG_BIN_DIR when given", () => {
    const cmd = buildPgCommand({ kind: "host", binDir: "/opt/pg/bin" }, "pg_restore", ["--no-owner", "-d", "x"], conn);
    expect(cmd.command.replace(/\\/g, "/")).toBe("/opt/pg/bin/pg_restore");
  });

  it("builds docker-mode commands against localhost:5432 inside the container", () => {
    const cmd = buildPgCommand({ kind: "docker", container: "billing-db" }, "pg_dump", ["-Fc", "-d", "billing"], conn);
    expect(cmd.command).toBe("docker");
    expect(cmd.args).toEqual([
      "exec",
      "-i",
      "-e",
      "PGPASSWORD",
      "billing-db",
      "pg_dump",
      "-h",
      "localhost",
      "-p",
      "5432",
      "-U",
      "alice",
      "-w",
      "-Fc",
      "-d",
      "billing",
    ]);
    expect(cmd.env).toEqual({ PGPASSWORD: "s3cr3t-pw" });
  });

  it("builds a docker-mode pg_restore command", () => {
    const cmd = buildPgCommand(
      { kind: "docker", container: "billing-db" },
      "pg_restore",
      ["--no-owner", "-d", "billing_restore_check"],
      conn,
    );
    expect(cmd.args.slice(0, 6)).toEqual(["exec", "-i", "-e", "PGPASSWORD", "billing-db", "pg_restore"]);
    expect(cmd.args.slice(-3)).toEqual(["--no-owner", "-d", "billing_restore_check"]);
  });

  it("never puts the password in argv and omits PGPASSWORD when there is none", () => {
    for (const mode of [{ kind: "host" as const }, { kind: "docker" as const, container: "billing-db" }]) {
      for (const tool of ["pg_dump", "pg_restore", "createdb", "dropdb"] as const) {
        const cmd = buildPgCommand(mode, tool, ["-x"], conn);
        expect(cmd.args.join(" ")).not.toContain("s3cr3t-pw");
        expect(cmd.command).not.toContain("s3cr3t-pw");
      }
    }
    const noPw = buildPgCommand({ kind: "host" }, "pg_dump", [], { ...conn, password: "" });
    expect(noPw.env).toEqual({});
  });
});

describe("compareCounts", () => {
  it("returns no mismatches when all tables match", () => {
    expect(compareCounts({ bills: 2, payments: 3 }, { bills: 2, payments: 3 })).toEqual([]);
  });

  it("reports differing counts and tables missing on either side", () => {
    expect(compareCounts({ bills: 2, payments: 3, a: 1 }, { bills: 2, payments: 2, b: 4 })).toEqual([
      { table: "a", source: 1, restored: undefined },
      { table: "b", source: undefined, restored: 4 },
      { table: "payments", source: 3, restored: 2 },
    ]);
  });
});
