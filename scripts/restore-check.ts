import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { Client } from "pg";
import {
  buildPgCommand,
  compareCounts,
  databaseUrlWithDatabase,
  newestBackup,
  parseDatabaseUrl,
  quoteIdent,
  resolveToolMode,
  SCRATCH_DATABASE,
  type DbConnection,
  type PgTool,
  type ToolMode,
} from "./lib/backup-utils";
import { runPg } from "./lib/pg-run";

async function tableCounts(connectionString: string): Promise<Record<string, number>> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const tables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    const counts: Record<string, number> = {};
    for (const { table_name } of tables.rows) {
      const res = await client.query<{ n: string }>(`select count(*)::text as n from public.${quoteIdent(table_name)}`);
      counts[table_name] = Number(res.rows[0].n);
    }
    return counts;
  } finally {
    await client.end();
  }
}

async function runTool(mode: ToolMode, tool: PgTool, args: string[], conn: DbConnection, dumpPath?: string): Promise<void> {
  const cmd = buildPgCommand(mode, tool, args, conn);
  const result = await runPg(cmd, dumpPath ? { stdin: createReadStream(dumpPath) } : {});
  if (result.code !== 0) {
    throw new Error(`${tool} failed (exit ${result.code})${result.stderr ? `: ${result.stderr}` : ""}`);
  }
}

/** Returns the process exit code. */
async function main(): Promise<number> {
  config({ path: ".env", quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  const conn = parseDatabaseUrl(url);
  if (conn.database === SCRATCH_DATABASE) {
    throw new Error(`refusing to run: the source database is the scratch database (${SCRATCH_DATABASE})`);
  }
  const mode = resolveToolMode(process.env);
  const dir = path.resolve(process.env.BACKUP_DIR?.trim() || "backups");

  const latest = newestBackup(await readdir(dir).catch(() => []));
  if (!latest) throw new Error(`no backup files (billing-YYYYMMDD-HHmm.dump) found in ${dir}`);
  const dumpPath = path.join(dir, latest);
  console.log(`restoring ${latest} (${(await stat(dumpPath)).size} bytes) into scratch database ${SCRATCH_DATABASE}`);

  let counts: { source: Record<string, number>; restored: Record<string, number> };
  try {
    await runTool(mode, "dropdb", ["--if-exists", SCRATCH_DATABASE], conn);
    await runTool(mode, "createdb", [SCRATCH_DATABASE], conn);
    await runTool(mode, "pg_restore", ["--no-owner", "-d", SCRATCH_DATABASE], conn, dumpPath);
    counts = {
      source: await tableCounts(url),
      restored: await tableCounts(databaseUrlWithDatabase(url, SCRATCH_DATABASE)),
    };
  } finally {
    try {
      await runTool(mode, "dropdb", ["--if-exists", SCRATCH_DATABASE], conn);
      console.log(`scratch database ${SCRATCH_DATABASE} dropped`);
    } catch (err) {
      console.error(`warning: could not drop scratch database ${SCRATCH_DATABASE}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const tables = [...new Set([...Object.keys(counts.source), ...Object.keys(counts.restored)])].sort();
  for (const t of tables) {
    console.log(`  ${t}: source=${counts.source[t] ?? "missing"} restored=${counts.restored[t] ?? "missing"}`);
  }

  const mismatches = compareCounts(counts.source, counts.restored);
  const missingKey = ["bills", "payments"].filter((t) => counts.restored[t] === undefined);
  if (mismatches.length > 0 || missingKey.length > 0) {
    console.error("restore MISMATCH");
    for (const m of mismatches) {
      console.error(`  ${m.table}: source=${m.source ?? "missing"} restored=${m.restored ?? "missing"}`);
    }
    for (const t of missingKey) console.error(`  expected table ${t} is missing from the restored database`);
    return 1;
  }
  console.log(`restore OK: bills=${counts.restored.bills} payments=${counts.restored.payments}`);
  return 0;
}

// Only run when executed directly (npm run backup:verify), never when imported.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(`restore check FAILED: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
