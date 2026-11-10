# Billing-

A billing and token management web app built with Next.js (App Router, TypeScript, Tailwind) and PostgreSQL (Drizzle ORM). See `docs/superpowers/specs/2026-11-10-billing-token-system-design.md` for the design.

## Setup

```bash
cp .env.example .env     # DATABASE_URL and DATABASE_URL_TEST
docker compose up -d     # Postgres 16 with databases `billing` and `billing_test`
npm install
npx playwright install chromium
npm run dev              # http://localhost:3000
```

Scripts: `npm run typecheck`, `lint`, `build`, `test:unit`, `test:int`, `test:e2e`, `db:generate`, `db:migrate`, `db:migrate:test`, `seed`.
