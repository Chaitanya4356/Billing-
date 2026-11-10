import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Safety net: the script entry points must actually run and fail closed (exit 1 with a message),
 * never silently do nothing and exit 0. Every case fails during validation, before any docker or
 * database access. DATABASE_URL is overridden with an unreachable dummy so a real one is never used.
 */
const root = path.resolve(__dirname, "..", "..");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const tempDirs: string[] = [];

function runScript(script: string, env: Record<string, string>) {
  const result = spawnSync(process.execPath, [tsxCli, path.join("scripts", script)], {
    cwd: root,
    shell: false,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      DATABASE_URL: "postgres://nobody:nopass@127.0.0.1:1/never_connected",
      BACKUP_DOCKER_CONTAINER: "",
      PG_BIN_DIR: "",
      ...env,
    },
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe("script entry points fail closed", { timeout: 90_000 }, () => {
  it("backup.ts rejects an invalid BACKUP_KEEP_DAYS with exit 1", () => {
    const r = runScript("backup.ts", { BACKUP_KEEP_DAYS: "0" });
    expect(r.status).toBe(1);
    expect(r.output).toContain("backup FAILED");
    expect(r.output).toContain("BACKUP_KEEP_DAYS must be a positive integer");
  });

  it("backup.ts rejects an invalid container name with exit 1", () => {
    const r = runScript("backup.ts", { BACKUP_DOCKER_CONTAINER: "bad name;" });
    expect(r.status).toBe(1);
    expect(r.output).toContain("BACKUP_DOCKER_CONTAINER is not a valid container name");
  });

  it("restore-check.ts rejects an invalid container name with exit 1", () => {
    const r = runScript("restore-check.ts", { BACKUP_DOCKER_CONTAINER: "bad name;" });
    expect(r.status).toBe(1);
    expect(r.output).toContain("restore check FAILED");
    expect(r.output).toContain("BACKUP_DOCKER_CONTAINER is not a valid container name");
    expect(r.output).not.toContain("restore OK");
  });

  it("restore-check.ts exits 1 when BACKUP_DIR has no backups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "billing-entry-test-"));
    tempDirs.push(dir);
    const r = runScript("restore-check.ts", { BACKUP_DIR: dir });
    expect(r.status).toBe(1);
    expect(r.output).toContain("no backup files");
    expect(r.output).not.toContain("restore OK");
  });
});
