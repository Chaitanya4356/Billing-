import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import {
  backupFileName,
  buildPgCommand,
  DEFAULT_KEEP_DAYS,
  parseDatabaseUrl,
  resolveToolMode,
  selectExpired,
} from "./lib/backup-utils";
import { runPg } from "./lib/pg-run";

function keepDaysFromEnv(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_KEEP_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error("BACKUP_KEEP_DAYS must be a positive integer");
  return n;
}

async function main(): Promise<void> {
  config({ path: ".env", quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  const conn = parseDatabaseUrl(url);
  const mode = resolveToolMode(process.env);
  const keepDays = keepDaysFromEnv(process.env.BACKUP_KEEP_DAYS);
  const dir = path.resolve(process.env.BACKUP_DIR?.trim() || "backups");

  await mkdir(dir, { recursive: true });
  const now = new Date();
  const fileName = backupFileName(now);
  const finalPath = path.join(dir, fileName);
  const partialPath = `${finalPath}.partial`;

  // Dump into a .partial file; only a complete, non-empty dump is renamed to the believable name.
  const cmd = buildPgCommand(mode, "pg_dump", ["-Fc", "-d", conn.database], conn);
  try {
    const result = await runPg(cmd, { stdout: createWriteStream(partialPath) });
    if (result.code !== 0) {
      throw new Error(`pg_dump failed (exit ${result.code})${result.stderr ? `: ${result.stderr}` : ""}`);
    }
    const { size } = await stat(partialPath);
    if (size === 0) throw new Error("pg_dump produced an empty file");
    await rename(partialPath, finalPath);
  } catch (err) {
    await rm(partialPath, { force: true });
    throw err;
  }

  const { size } = await stat(finalPath);
  console.log(`backup written: ${fileName} (${size} bytes)`);

  const expired = selectExpired(await readdir(dir), now, keepDays);
  for (const name of expired) {
    await rm(path.join(dir, name));
    console.log(`pruned expired backup: ${name}`);
  }
  console.log(`retention: ${keepDays} days, pruned ${expired.length} file(s)`);
}

// Entry point: runs unconditionally. Any rejection prints the failure and exits 1 (fail closed).
main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`backup FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
