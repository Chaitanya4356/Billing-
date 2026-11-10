/**
 * Pure helpers for the backup and restore-check scripts.
 * No I/O and no database client here so that unit tests can import this module freely.
 */
import path from "node:path";

export const BACKUP_PATTERN = /^billing-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.dump$/;
export const DEFAULT_KEEP_DAYS = 30;
/** Fixed scratch database for the restore drill; never taken from the environment. */
export const SCRATCH_DATABASE = "billing_restore_check";
/** Container that belongs to another project; the scripts must never address it. */
export const PROTECTED_CONTAINER = "misthi-foods-db";

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** `billing-YYYYMMDD-HHmm.dump`, in UTC. */
export function backupFileName(now: Date): string {
  return (
    `billing-${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}.dump`
  );
}

interface ParsedBackup {
  name: string;
  /** UTC calendar day as YYYYMMDD. */
  day: number;
  /** Sortable key: YYYYMMDDHHmm. */
  stamp: number;
}

function parseBackupName(name: string): ParsedBackup | undefined {
  const m = BACKUP_PATTERN.exec(name);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const valid =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi;
  if (!valid) return undefined;
  return { name, day: y * 10000 + mo * 100 + d, stamp: Number(`${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`) };
}

export function isBackupFileName(name: string): boolean {
  return parseBackupName(name) !== undefined;
}

/** The newest file whose name matches the backup pattern, if any. */
export function newestBackup(files: string[]): string | undefined {
  const parsed = files.map(parseBackupName).filter((p): p is ParsedBackup => p !== undefined);
  if (parsed.length === 0) return undefined;
  return parsed.reduce((a, b) => (b.stamp > a.stamp ? b : a)).name;
}

/**
 * Backups to delete: those whose UTC day is older than the UTC day `keepDays` before `now`
 * (a file dated exactly `keepDays` days ago is kept). Names that do not match the pattern
 * are ignored. The newest backup is never returned, so retention can never delete the last one.
 */
export function selectExpired(files: string[], now: Date, keepDays: number = DEFAULT_KEEP_DAYS): string[] {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - keepDays));
  const cutoffDay = cutoff.getUTCFullYear() * 10000 + (cutoff.getUTCMonth() + 1) * 100 + cutoff.getUTCDate();
  const newest = newestBackup(files);
  return files.filter((f) => {
    const p = parseBackupName(f);
    return p !== undefined && p.name !== newest && p.day < cutoffDay;
  });
}

export interface DbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Parses a postgres:// URL. Error messages never include the URL (it holds the password). */
export function parseDatabaseUrl(url: string): DbConnection {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a postgres:// or postgresql:// URL");
  }
  if (!u.hostname) throw new Error("DATABASE_URL has no host");
  if (!u.username) throw new Error("DATABASE_URL has no user");
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL has no database name");
  return {
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
  };
}

/** The same URL pointing at a different database (credentials, host and query are kept as-is). */
export function databaseUrlWithDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function validateContainerName(name: string): string {
  if (!CONTAINER_NAME.test(name)) throw new Error("BACKUP_DOCKER_CONTAINER is not a valid container name");
  if (name === PROTECTED_CONTAINER) throw new Error("BACKUP_DOCKER_CONTAINER must not name another project's container");
  return name;
}

export type ToolMode = { kind: "host"; binDir?: string } | { kind: "docker"; container: string };

export function resolveToolMode(env: Record<string, string | undefined>): ToolMode {
  const container = env.BACKUP_DOCKER_CONTAINER?.trim();
  if (container) return { kind: "docker", container: validateContainerName(container) };
  const binDir = env.PG_BIN_DIR?.trim();
  return { kind: "host", binDir: binDir || undefined };
}

export type PgTool = "pg_dump" | "pg_restore" | "createdb" | "dropdb";

export interface PgCommand {
  command: string;
  args: string[];
  /** Extra environment for the child process (holds the password; never logged). */
  env: Record<string, string>;
}

/**
 * Builds the spawn() command for a PostgreSQL client tool. Connection flags come first,
 * then `toolArgs`. The password travels only through the PGPASSWORD environment variable
 * (for `docker exec`, `-e PGPASSWORD` forwards the client's value without putting it in argv).
 * In docker mode the tool connects to localhost:5432 inside the container.
 */
export function buildPgCommand(mode: ToolMode, tool: PgTool, toolArgs: string[], conn: DbConnection): PgCommand {
  const env: Record<string, string> = conn.password ? { PGPASSWORD: conn.password } : {};
  if (mode.kind === "docker") {
    const forward = conn.password ? ["-e", "PGPASSWORD"] : [];
    return {
      command: "docker",
      args: ["exec", "-i", ...forward, mode.container, tool, "-h", "localhost", "-p", "5432", "-U", conn.user, "-w", ...toolArgs],
      env,
    };
  }
  const command = mode.binDir ? path.join(mode.binDir, tool) : tool;
  return {
    command,
    args: ["-h", conn.host, "-p", String(conn.port), "-U", conn.user, "-w", ...toolArgs],
    env,
  };
}

export interface CountMismatch {
  table: string;
  source: number | undefined;
  restored: number | undefined;
}

/** Tables whose counts differ (or that exist on one side only), sorted by table name. */
export function compareCounts(source: Record<string, number>, restored: Record<string, number>): CountMismatch[] {
  const tables = [...new Set([...Object.keys(source), ...Object.keys(restored)])].sort();
  return tables
    .filter((t) => source[t] !== restored[t])
    .map((t) => ({ table: t, source: source[t], restored: restored[t] }));
}
