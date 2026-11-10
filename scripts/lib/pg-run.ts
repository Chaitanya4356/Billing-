/**
 * Runs a PostgreSQL client tool (directly or through `docker exec`) with spawn(), never through a shell.
 * Dump bytes flow over stdout into a local file stream; restores read a local file stream on stdin.
 */
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PgCommand } from "./backup-utils";

export interface PgRunResult {
  code: number | null;
  /** Tail of the tool's stderr (connection details and the password are never part of it). */
  stderr: string;
}

export function runPg(cmd: PgCommand, io: { stdin?: Readable; stdout?: Writable } = {}): Promise<PgRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...cmd.env },
      stdio: [io.stdin ? "pipe" : "ignore", io.stdout ? "pipe" : "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });

    const transfers: Promise<void>[] = [];
    if (io.stdout && child.stdout) transfers.push(pipeline(child.stdout, io.stdout));
    // A tool that exits early closes stdin (EPIPE); its exit code is what matters then.
    if (io.stdin && child.stdin) transfers.push(pipeline(io.stdin, child.stdin).catch(() => undefined));
    for (const t of transfers) t.catch(() => undefined);

    child.on("error", (err) => {
      io.stdout?.destroy();
      io.stdin?.destroy();
      reject(new Error(`could not start ${cmd.command}: ${err.message}`));
    });
    child.on("close", (code) => {
      Promise.all(transfers).then(
        () => resolve({ code, stderr: stderr.trim() }),
        (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
  });
}
