# Billing

A counter billing and token management web app for one tea shop or small restaurant: fast sales with unique bill
and daily token numbers, thermal receipts (58/80 mm), bill history, cash/UPI reports with CSV export, and owner and
cashier roles. Built with Next.js (App Router, TypeScript strict, Tailwind) and PostgreSQL (Drizzle ORM). Online-only
by design.

## Quick start (development)

```bash
cp .env.example .env          # DATABASE_URL and DATABASE_URL_TEST
docker compose up -d          # Postgres 16 with databases `billing` and `billing_test`
npm install
npx playwright install chromium
npm run db:migrate            # create the tables
SEED_SHOP_NAME="My Shop" SEED_OWNER_USERNAME=owner SEED_OWNER_PASSWORD=change-me-now npm run seed
npm run dev                   # http://localhost:3000
```

Sign in with the seeded owner account. On bash use the inline variables as shown; in PowerShell set them with
`$env:SEED_SHOP_NAME = "..."` first, or put them in `.env`.

## Scripts and tests

| Command | What it does |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run build` | Static checks and production build |
| `npm run test:unit` | Vitest unit tests (no database) |
| `npm run test:int` | Vitest integration tests (test database `billing_test`) |
| `npm run test:e2e` | Playwright end-to-end tests (starts its own dev server on port 3000 against the test database) |
| `npm run db:generate`, `db:migrate`, `db:migrate:test` | Drizzle migrations |
| `npm run seed` | Create the first shop and owner |
| `npm run backup`, `npm run backup:verify` | Nightly dump and restore drill |

`GET /api/health` answers `200 {"status":"ok"}` when the database is reachable (public, for uptime monitors).

## Documentation

- Operations runbook (setup, daily use, outage procedure, go-live gates): [docs/ops/runbook.md](docs/ops/runbook.md)
- Backups and restore drill: [docs/ops/backup-restore.md](docs/ops/backup-restore.md)
- Design spec: [docs/superpowers/specs/2026-11-10-billing-token-system-design.md](docs/superpowers/specs/2026-11-10-billing-token-system-design.md)
- Implementation plan: [docs/superpowers/plans/2026-11-10-billing-token-system.md](docs/superpowers/plans/2026-11-10-billing-token-system.md)
