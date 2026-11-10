# Operations runbook

For the person who sets up and looks after the Billing app. The design background is in
`docs/superpowers/specs/2026-11-10-billing-token-system-design.md` (sections 5 and 12). Backups and restores are
covered in detail in [backup-restore.md](./backup-restore.md).

Sections marked **To be filled in once the host is chosen** depend on the hosting provider, which has not been
decided yet. Everything else is host-independent.

## 1. Requirements

- A host that can run Node.js 24 (`npm run build && npm run start`), with **HTTPS in front of the app**. HTTP must
  redirect to HTTPS or be refused.
- A managed PostgreSQL 16 database in an **Indian region** (low latency for the counter), with automated backups and
  point-in-time recovery (PITR).
- A counter PC with Windows and a current Chrome or Edge, a thermal receipt printer (58 mm or 80 mm), and a
  backup internet connection (phone hotspot).

**To be filled in once the host is chosen:** provider, region, how to deploy, how to set environment variables,
where the logs are, who holds the provider account.

## 2. Configuration (environment variables)

The app refuses to touch the database if its configuration is wrong. It prints one error listing every missing or
invalid variable by name; it never prints the values.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://user:password@host:5432/database` (`postgresql://` also works). Add `?sslmode=require` if the provider requires TLS. |
| `NODE_ENV` | no | `development`, `test` or `production`. `npm run build` and `npm run start` set `production` themselves; any other value (for example `staging`) is rejected. |
| `SEED_SHOP_NAME`, `SEED_OWNER_USERNAME`, `SEED_OWNER_PASSWORD` | first run only | Used by `npm run seed` once. Remove them from the environment afterwards. |
| `LOGIN_RATE_LIMIT_ENABLED` | no | `1` turns the sign-in rate limit (section 10) on outside production. It is always on when `NODE_ENV=production`; leave this unset there. |
| `BACKUP_DIR`, `BACKUP_KEEP_DAYS`, `PG_BIN_DIR`, `BACKUP_DOCKER_CONTAINER` | backups only | See [backup-restore.md](./backup-restore.md). |

Secrets live **only** in environment variables (or the host's secret store). Never commit `.env`, never paste the
database URL into chat or tickets.

## 3. First-run setup

1. **Install and build** on the host:

   ```bash
   npm ci
   npm run build
   ```

2. **Set the environment variables** from section 2 (`DATABASE_URL` at least).
3. **Create the tables:** `npm run db:migrate`. Run this on every release before starting the new version.
4. **Create the shop and the owner account** (once; it does nothing if a shop already exists):

   ```bash
   SEED_SHOP_NAME="Shop name" SEED_OWNER_USERNAME=<choose-a-non-obvious-owner-username> SEED_OWNER_PASSWORD='a-long-temporary-password' npm run seed
   ```

   The username must be 3 to 32 characters of `a-z`, `0-9`, `.`, `_` or `-`. Choose a non-obvious owner username (not
   `owner` or `admin`): anyone who knows it can lock the owner out with wrong passwords, and a locked owner account can
   only wait out the 15-minute lock. The password must be at least 8 characters. Use a throw-away value.
5. **Start the app:** `npm run start`, behind HTTPS. Open the site and sign in as the owner.
6. **Change the owner password immediately:** Settings > Users > **Change my password**. You are signed out
   everywhere and sign in again with the new password. Then remove the `SEED_*` variables.
7. **Configure Settings** (owner only). Settings has the tabs Shop, Numbering, GST, Discounts, Receipt, Users and
   Audit log:
   - **Shop:** name, address, phone, GSTIN (if registered).
   - **GST:** whether GST is charged, the rate, and whether prices include GST. **The accountant must confirm the
     mode (registered or composition), the rate, the GSTIN and the receipt title before go-live.** Until then keep
     GST off. Optionally round totals to the nearest rupee.
   - **Numbering:** bill prefix (1 to 6 capital letters or digits), whether tokens restart every day or never, and
     the hour the business day starts (bills before that hour count towards the previous day).
   - **Discounts:** the maximum flat (rupees) and percentage discount a cashier may give; owners are unlimited.
     Also here: whether cashiers may cancel bills (same business day only).
   - **Receipt:** receipt title, header, footer and **paper width (58 mm or 80 mm)**. The preview shows the layout;
     "Test Print" prints sample data and creates no bill.
8. **Add categories and products** (Products page): names, prices, enable/disable.
9. **Create cashier accounts:** Settings > Users > Create cashier. Give each person their own account; do not share logins.

## 4. Daily operation

**Opening**
- Turn on the PC and printer, open the site, sign in. Check the receipt paper.
- If the site seems slow or broken, check `/api/health` (section 7).

**During the day**
- Billing screen: pick items, choose Cash or UPI, Charge. The success screen shows the large token number and a
  **Print** button. Printing is always a manual click; a failed print never affects the saved bill.
- Reprint: Bills > open the bill > **Reprint**. It prints the stored bill marked as a reprint, creates no new bill
  or token, and is audited. Opening a bill never prints.
- Cancel: Bills > open the bill > Cancel, with a mandatory reason. The owner can cancel any bill. Cashiers can cancel
  only if the owner enabled "Cashiers can cancel bills", and then only bills of the **current business day**.
  Cancelled bills stay in history (labelled CANCELLED), keep their bill number and token (never reused), and drop out
  of sales totals. Bills cannot be edited: cancel and bill again.
- Cashiers see only Billing and Bills (today's business day). Owners also see Dashboard, Products, Reports and
  Settings.

**Closing**
- Owner: check Dashboard or Reports (Day tab) for the cash and UPI totals. Count the cash drawer against the cash
  total; check the UPI total against the UPI app. UPI is confirmed manually by the cashier, so this review is the
  control.
- Reports: Day, Week and Month tabs with a date picker. **Export CSV** downloads one row per bill plus a summary.
- Sign out on the shared counter PC.

## 5. Internet outage procedure

The app is online-only: when the internet is down, billing is unavailable.

1. **First:** switch the counter PC to the **backup phone hotspot** (keep the phone charged, with data, and the
   hotspot name and password written down at the counter). Reload the site.
2. **Last resort:** if there is no connection at all, write bills in the **paper bill book** (item, quantity, price,
   total, cash or UPI), using the book's own page numbers.
3. **Paper bills are not entered into the system afterwards in v1.** They stay on paper (keep the book safe); the
   system does not know about them, so day totals in Reports will not include them. Note the paper totals separately
   when closing the day.
4. **When connectivity returns,** carry on with the next token and bill number the system gives. There is nothing to
   reconcile in the system, and no numbers are skipped, because the system never issued any during the outage.
5. If the internet is fine but the site is not responding, check `/api/health` (section 7) and then the host and
   database status pages.

## 6. Optional: Windows `--kiosk-printing` shortcut

By default each Print click opens the browser's print dialog. A dedicated shortcut can send the receipt straight to
the printer instead. This needs no code changes and is optional.

1. Make sure the thermal printer is the **Windows default printer**, with the correct paper size (the 58 mm or 80 mm
   roll) and **zero margins** in its printing preferences. Without this the receipt can be cut off or print on the
   wrong paper.
2. Copy the Chrome (or Edge) shortcut. In its Properties > Target, append the flag after the program path and before
   the address:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://YOUR-APP-URL
   ```

   (Edge: `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk-printing https://YOUR-APP-URL`.)
3. Close all Chrome/Edge windows first and always start from this shortcut. The flag applies only to browser
   instances started with it (a browser that is already running ignores it). Adding
   `--user-data-dir="C:\billing-profile"` keeps this browser profile apart from other browsing.
4. Printing stays a **manual click** either way: the cashier still presses Print (or Reprint). The flag only removes
   the dialog.
5. If something goes wrong, start Chrome normally: the dialog comes back and you can pick another printer.

Record the printer model and test it with [printer-test-checklist.md](./printer-test-checklist.md).

## 7. Health check

`GET /api/health` is public (no sign-in) and meant for uptime monitors.

- `200` with `{"status":"ok"}`: the app is running and the database answered a trivial query.
- `503` with `{"status":"unavailable"}`: the app is running but the database check failed or took longer than about
  3 seconds. The body never contains error details; look at the host logs for the cause.
- The response is never cached (`Cache-Control: no-store`).

Point an external uptime monitor at `https://YOUR-APP-URL/api/health`, check every 1 to 5 minutes, alert on anything
but `200`, and send the alert to the owner and the person who looks after the system.

## 8. Backups and restore drills

Two layers (details and commands in [backup-restore.md](./backup-restore.md)):

- **Provider automated backups with point-in-time recovery:** turn on in the database console before go-live.
- **Nightly logical dump:** `npm run backup` every night (for example 02:30), kept 30 days, **copied off the
  database host**. Check the schedule's log regularly: a non-zero exit means no backup was made that night.
- **Restore drill:** `npm run backup && npm run backup:verify` before go-live and at least every 3 months; write down
  the date and the `restore OK` line.

**To be filled in once the host is chosen:** where the job runs, where the off-site copies go, where the PITR setting
is, who receives the failure alerts.

## 9. Go-live gates

Do not take real sales until every item is true:

- [ ] The accountant confirmed the GST settings (mode, rate, GSTIN, receipt title) and they are entered in Settings.
- [ ] The printer model is recorded and [printer-test-checklist.md](./printer-test-checklist.md) is completed (58 mm
      and/or 80 mm, whichever the shop uses).
- [ ] A restore drill passed **in production** (`npm run backup:verify`, `restore OK`), and PITR is on.
- [ ] The owner changed the seeded password (Settings > Users > Change my password) and the `SEED_*` variables are gone.
- [ ] A pilot week ran with real sales, the owner reviewed each day's totals, and the issues found were fixed.
- [ ] The outage procedure (section 5) was read by everyone at the counter; the hotspot and paper bill book are in place.

## 10. Security notes

- **HTTPS only.** In production the app sends `Strict-Transport-Security`, and the session cookie is marked `Secure`
  when `NODE_ENV=production`. Run it with `npm run build && npm run start`, never in development mode.
- **Secrets only in environment variables.** Rotate the database password if it was ever shown in a log or chat.
- **Least-privilege database role:** the app's `DATABASE_URL` user should own only this database and must not be a
  superuser. Run migrations (`npm run db:migrate`) with a role that may change the schema; the backup drill needs
  `CREATEDB` on the machine where it runs.
- **Headers:** every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: same-origin`; `X-Powered-By` is removed. There is deliberately no Content-Security-Policy in v1.
- **Sessions:** server-side, httpOnly cookie, 12 hours from sign-in. Changing or resetting a password signs that
  user out everywhere; deactivating a user signs them out at once.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes. Sign-in failures, lockouts and other important
  actions are in the audit log (Settings > Audit log).
- **Sign-in rate limit:** in production each client address may make at most 10 sign-in attempts per 5 minutes
  (successful or not); further attempts get "Too many sign-in attempts. Please wait a few minutes and try again."
  without checking the password or writing an audit entry. The client address is the first `X-Forwarded-For` entry,
  else `X-Real-IP`. The counters are **in memory, per app process**: they reset when the app restarts, and with
  several app instances each keeps its own counters. Behind a reverse proxy or load balancer, the proxy **must set or
  overwrite** `X-Forwarded-For` (otherwise a client can pick its own address, and all clients may share one counter).
  A rate limit at the host or proxy level is still recommended. Several cashiers behind the same shop router share one
  address, so ten wrong attempts in five minutes at the counter pause sign-in for everyone there until the window
  ends.
- **Who can see what:** owners see everything (all dates, reports, CSV, settings, users, audit log). Cashiers see
  Billing and today's bills only. Customer name and phone appear only on bills, to signed-in users who can see the
  bill. Backup dumps contain all of this data: restrict access to them.

## 11. Troubleshooting: what to do if...

| Problem | What to do |
| --- | --- |
| A user cannot sign in | Check the username and that Caps Lock is off. If the message says the account is locked, wait 15 minutes. For a cashier, the owner can instead reset the password (Settings > Users > Reset password), which unlocks the account at once. A locked owner account has no one to reset it: wait 15 minutes. A deactivated user cannot sign in until reactivated. |
| "Too many sign-in attempts. Please wait a few minutes and try again." | More than 10 sign-in attempts came from this address within 5 minutes (section 10). Wait up to 5 minutes and try again; restarting the app also clears the counters. |
| "Prices or tax settings changed. Please review the new total and charge again." | A product price, discount rule or tax setting changed while the cart was open. Nothing was charged and no number was used. Check the new total on screen, tell the customer if it differs, and press Charge again. |
| The site shows an error or will not load | Open `/api/health`. `503`: the database is unreachable or slow, check the database provider's status and `DATABASE_URL`. No response: the app or the internet is down, see section 5. |
| The app reports "Invalid environment configuration" | It lists each variable by name. Fix those variables (section 2) and restart. |
| The receipt prints blank or cut off | Check the Windows default printer, the printer's paper size (58 mm or 80 mm) and zero margins, and that Settings > Receipt > Paper width matches the roll. Use Settings > Receipt > Test Print to check without creating a bill. Reprint the bill afterwards from Bills. Then work through [printer-test-checklist.md](./printer-test-checklist.md). |
| The print dialog appears on every print | That is the default. Use the optional shortcut in section 6 to skip it. |
| A bill was charged wrongly | Bills cannot be edited. Cancel it (owner, or cashier if allowed and same day) with a reason, then create a new bill. |
| The bill number looks unfamiliar | Format is `PREFIX-2627-000123`: the Settings > Numbering prefix, the financial year (April to March; `2627` means 2026-27), then a 6-digit counter that restarts each financial year, for example `B-2627-000123`. Numbers are never reused, even for cancelled bills. |
| Token numbers restarted unexpectedly | Tokens restart each business day (or never, per Settings > Numbering) and the day starts at the configured hour, not necessarily midnight. |
| Totals in Reports look low after an outage | Paper bills are not in the system (section 5), and cancelled bills are excluded from sales totals. |
| The backup job failed | Read the job log (`backup FAILED: ...`), fix the cause (disk space, credentials, missing `pg_dump`), run `npm run backup` by hand, then `npm run backup:verify`. |
| Data was deleted or corrupted | Stop the app and follow "Emergency restore into production" in [backup-restore.md](./backup-restore.md). Prefer provider PITR for recent incidents. |

**To be filled in once the host is chosen:** who to call (owner, developer, hosting support) with phone numbers.
