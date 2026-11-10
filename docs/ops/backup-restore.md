# Backups and restore drill

## What is backed up

Two independent layers:

1. **Managed provider backups with point-in-time recovery (PITR).** Turn this on in the database provider's
   console before go-live (automated backups plus WAL/PITR, retention as long as the plan allows). This is the
   primary way to recover from an accidental delete or a bad deploy: restore to a moment just before the incident.
2. **Nightly logical dump** with `npm run backup`, kept for 30 days and copied off the database host. It protects
   against provider-level loss (account problem, region outage, bad provider restore) and gives a portable file
   you can restore anywhere.

A restore is tested **before go-live and at least quarterly** (see "Restore drill").

## The nightly dump: `npm run backup`

`scripts/backup.ts` runs `pg_dump -Fc` (custom format) against `DATABASE_URL` and writes
`billing-YYYYMMDD-HHmm.dump` (UTC time) into `BACKUP_DIR` (default `./backups`, git-ignored).

- The dump is written to `<name>.partial` and renamed to the final name only after `pg_dump` exits 0 and the file
  is non-empty. A crash or failure never leaves a believable-looking corrupt backup; the partial file is removed
  and the script exits with code 1 and a message.
- Afterwards it deletes dumps older than `BACKUP_KEEP_DAYS` (default 30). Age is measured in UTC calendar days
  (a dump from exactly 30 days ago is kept). Files that do not match the naming pattern are never touched, and the
  newest dump is never deleted, even if everything is old.
- Two runs in the same UTC minute produce the same file name; the second replaces the first.
- Output only contains file names, sizes and counts. The database password is passed to the tools through the
  `PGPASSWORD` environment variable and never appears in arguments or logs.

Environment (read from the process environment, or `.env` in the project directory):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | Source database, `postgres://user:password@host:port/database` |
| `BACKUP_DIR` | `./backups` | Where dumps are written and pruned |
| `BACKUP_KEEP_DAYS` | `30` | Retention in days |
| `PG_BIN_DIR` | (PATH) | Directory containing `pg_dump`, `pg_restore`, `createdb`, `dropdb` |
| `BACKUP_DOCKER_CONTAINER` | unset | Docker dev mode, see below |

The host needs the PostgreSQL 16 client tools (`pg_dump`, `pg_restore`, `createdb`, `dropdb`); a client older than
the server version will refuse to dump.

It also needs a checkout of the app installed with **all** dependencies (`npm ci`, not `npm ci --omit=dev`):
`npm run backup` and `npm run backup:verify` run `tsx scripts/...` and load `.env` with `dotenv`, and both are
development dependencies. See the first-run steps in [runbook.md](./runbook.md) (section 3).

### Scheduling

Linux (cron, as the user that owns the app; every night at 02:30):

```cron
30 2 * * * cd /srv/billing && /usr/bin/env npm run backup >> /var/log/billing-backup.log 2>&1
```

Windows (Task Scheduler, daily 02:30):

```powershell
schtasks /Create /TN "Billing nightly backup" /SC DAILY /ST 02:30 /TR "cmd /c cd /d C:\billing && npm run backup >> C:\billing\backup.log 2>&1"
```

Both examples run `npm run backup` from the app directory (`/srv/billing`, `C:illing`), which must be a full
`npm ci` install (the script runs through `tsx`), with `node` and `npm` on the PATH of the account the job runs as.

Check the log regularly: a non-zero exit code (and `backup FAILED: ...` on stderr) means no backup was made that
night. Wire the exit code into whatever alerting you have.

### Off-site copy

The dump directory is on the same machine as the app, so it is not a disaster backup until it is copied elsewhere.
After `npm run backup` succeeds, copy the new file to storage that is separate from the database host and the
provider account: an object storage bucket (any S3-compatible service), another machine over `scp`/`rsync`, or an
external drive that is kept offline. Keep 30 days there too (a bucket lifecycle rule or the same pruning idea).
The copy step is the operator's responsibility and is deliberately not part of the scripts, so there is no vendor
lock-in. Restrict access to the copies: they contain customer and billing data.

## Restore drill: `npm run backup:verify`

`scripts/restore-check.ts` proves that the newest dump can actually be restored:

1. Picks the newest `billing-YYYYMMDD-HHmm.dump` in `BACKUP_DIR` (error if there is none).
2. Drops (if present) and creates the scratch database `billing_restore_check` on the same server. The name is a
   fixed constant, and the script refuses to run if the source database has that name.
3. Runs `pg_restore --no-owner -d billing_restore_check` from the dump.
4. Compares exact row counts of **every table in the `public` schema** between the source and the scratch database,
   printing one line per table.
5. Prints `restore OK: bills=<n> payments=<n>` and exits 0 if all counts match; otherwise prints
   `restore MISMATCH` with the differing tables and exits 1.
6. Always drops the scratch database at the end, even on failure.

Because the source keeps changing after the dump was taken, run the check right after `npm run backup` for an exact
comparison; on a busy production database a small difference in recently written tables is expected and should be
explained, not ignored. The DB user in `DATABASE_URL` needs the `CREATEDB` privilege (the default `postgres` user
has it).

**Quarterly drill:** at least every three months, and before go-live, run `npm run backup && npm run backup:verify`
(ideally against a dump that was copied back from the off-site location, to test that copy too) and record the date
and the `restore OK` line. Also open the app against a restored copy once in a while to check it is usable, not only
that row counts match.

## Emergency restore into production

High level; adapt to the incident. Prefer provider PITR when the problem is "something went wrong a few minutes
ago". Use a dump when PITR is unavailable or the provider is the problem.

1. **Stop the app** (and any scheduled job that writes to the database) so nothing writes during the restore.
2. Pick the dump (newest, or the last one before the incident). Take a fresh dump of the current state first if the
   database is still readable, so the failed state can be examined later.
3. Restore into an empty database (a new database or a new instance is safest):

   ```bash
   createdb -h HOST -U USER billing_new
   pg_restore --no-owner -h HOST -U USER -d billing_new billing-YYYYMMDD-HHmm.dump
   ```

   To restore over the existing database instead, add `--clean --if-exists` to `pg_restore` and expect it to drop
   and recreate the objects (this destroys whatever is currently there). Use `--no-owner` unless the original roles
   exist on the target. Pass the password with the `PGPASSWORD` environment variable.
4. Check the row counts (as `backup:verify` does) and spot-check recent bills.
5. Point `DATABASE_URL` at the restored database, start the app, and verify a login and a new bill.
6. Anything written after the dump's timestamp is lost; reconcile it from paper records or the provider's PITR.

## Docker dev mode

On a development machine without PostgreSQL client tools, run the same tools inside the dev database container.
Set (for example in `.env`, see `.env.example`):

```
BACKUP_DOCKER_CONTAINER=billing-db
```

The scripts then call `docker exec -i billing-db pg_dump ...` (and `pg_restore`, `createdb`, `dropdb`), connecting
to `localhost:5432` inside the container with the user and database from `DATABASE_URL`. Dump bytes travel over
the process pipes to and from local files, so no shell redirection is involved and it works on Windows. The row
counts are read from the host through `DATABASE_URL`, so the database must be reachable there as well. The
container name is validated, and the scripts never act on any other container than the one named.
