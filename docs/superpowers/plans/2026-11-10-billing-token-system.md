# Billing & Token Management System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build v1 of a cloud-hosted, single-shop billing and token system: billing, tokens, cash/UPI, discounts, GST, manual 58/80mm receipt printing, bill history with cancel/reprint, dashboard, reports with CSV, owner/cashier roles, audit log and backups.

**Architecture:** One Next.js App Router monolith over PostgreSQL. Business logic lives in framework-free services under `src/modules/<module>/`; Server Actions are thin wrappers (Zod, session, role, then service). All money is integer paise. Bill and token numbers come from atomic counter rows inside the bill-creation transaction.

**Tech Stack:** Node.js LTS (>= 22), Next.js (latest stable, App Router), React, TypeScript strict, Tailwind CSS, PostgreSQL 16, Drizzle ORM + drizzle-kit, `pg`, Zod, `@node-rs/argon2`, Vitest, Playwright, tsx. Pin exact versions in `package.json` when scaffolding.

**Spec:** `docs/superpowers/specs/2026-11-10-billing-token-system-design.md`

## Global Constraints

Every task's requirements include these (values copied from the spec):

- Money is **integer paise**; percentages are **basis points**. No floats in money paths.
- Timestamps are `timestamptz` (UTC). Timezone is `Asia/Kolkata`. `business_date` is derived in IST honouring `day_start_hour`.
- Hosting is **online-only**; no offline mode, no auto/silent printing, **manual print only**.
- Customer data is only optional `customer_name` and `customer_phone` on the bill. English only. INR only.
- Quantity is an integer **1-999**. Password minimum length is **8**.
- Bill number display: prefix + financial year + 6 digits, e.g. `B-2627-000123`, reset each financial year. Token resets daily at `day_start_hour` (default 0) or never (setting).
- Counters are incremented **bill first, then token**, inside the bill transaction. A rollback rolls back the counters (no gaps).
- Bills, items and payments have **no update or delete path** except the controlled cancel. Nothing is ever deleted.
- `shopId` comes only from the session, never from client input. Role checks happen in every service call.
- Cashier: sees today's business day bills only; discounts within owner-configured limit; cannot cancel unless owner enables it (same business day only).
- Paper widths 58 and 80 mm; printable width about 48mm and 72mm; `@page` margin 0.
- Weeks start Monday; months are calendar months in IST. Reports exclude CANCELLED bills and show them separately.
- Audit actions: login failure/lockout, bill created, printed/reprinted, cancelled, product created/updated/price changed/disabled, settings changed, user created/password reset/deactivated.

### Additions to the spec made by this plan (flag if you disagree)

- `sessions` table (spec requires server-side sessions but lists no table); session lifetime **12 hours**.
- `users.failed_attempts`, `users.locked_until` for lockout (5 consecutive failures, 15 minutes). Per-account only; IP-level limiting is left to the host platform.
- `bills.tax_included boolean` so the total CHECK constraint can differ for inclusive and exclusive GST.
- Cashier discount limits default to **0** (cashiers cannot discount until the owner sets a limit).
- `login` resolves the single shop (v1 has exactly one shop).
- Owner can change their own password (`changeOwnPassword`).
- Audit actions `CATEGORY_CHANGED`, and `BILL_PRINTED` (first print) vs `BILL_REPRINTED` (later prints).
- Switching token reset mode mid-day re-syncs the token counter so unique `(shop, business_date, token)` is never violated.

## Review Focus

Inputs the spec implies but its own examples do not exercise, most likely first. Each has a test in the owning task.

1. **A bill rung around midnight or before the day-start hour** (23:59 vs 00:01 IST; 02:00 with day-start 4) lands on the expected business day and token sequence. Tests: Tasks 2, 10, 17.
2. **Double-clicked or retried Charge, and a rejected Charge**: exactly one bill/token per sale; a rejected charge consumes no number. Tests: Tasks 10, 14.
3. **Rupee text entry** (`12.5`, `₹1,200`, blank, `1.005`, `abc`) becomes exact paise or is rejected, for product prices, cash tendered and discounts. Tests: Tasks 2, 9, 14.
4. **Product or customer names containing `<`, `&`, quotes, emoji or 100+ characters** print safely and wrap on the receipt. Test: Task 11.
5. **A deactivated user or one whose password was reset still holding a live session** is rejected on the next request. Tests: Tasks 6, 19.

## File Structure

```
src/lib/        types.ts errors.ts money.ts time.ts phone.ts env.ts action-result helpers
src/db/         client.ts schema/{shops,users,catalog,bills,sequences,audit}.ts index.ts migrations/
src/modules/
  auth/         password.ts session.ts service.ts guards.ts nav.ts actions.ts
  audit/        service.ts
  shop/         schema.ts service.ts actions.ts
  catalog/      schema.ts service.ts actions.ts
  billing/      calc.ts schema.ts sequences.ts service.ts cart.ts actions.ts
  bills/        types.ts repo.ts service.ts actions.ts
  printing/     receipt.ts render-html.ts sample.ts service.ts print-client.ts
  reports/      service.ts csv.ts actions.ts
  users/        service.ts actions.ts
src/app/        login/ (app)/{billing,bills,products,reports,dashboard,settings}/ api/health
scripts/        seed.ts backup.ts restore-check.ts
tests/          unit/ integration/ e2e/ helpers/
docs/ops/       runbook.md backup-restore.md printer-test-checklist.md
```

Each service takes `(ctx: AuthContext, ...)`, imports the shared `db` from `src/db/client.ts`, and throws `AppError`. Server Actions wrap services with `runAction`.

---

### Task 1: Project scaffold and tooling

**Files:**
- Create: `package.json`, `tsconfig.json` (strict), `next.config.ts`, Tailwind/PostCSS config, `.gitignore` (node_modules, .next, .env*, backups/), `.env.example`, `docker-compose.yml`, `docker/init-db.sql`, `vitest.config.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `lint`, `typecheck`, `test:unit`, `test:int`, `test:e2e`, `db:generate`, `db:migrate`, `db:migrate:test`, `seed`; env vars `DATABASE_URL`, `DATABASE_URL_TEST`; Vitest projects `unit` (tests/unit) and `integration` (tests/integration, `fileParallelism: false`); path alias `@/*` → `src/*`.

- [ ] **Step 1:** `git init` in `D:\Billing` (it is not a repository yet). Scaffold with `create-next-app` (TypeScript, Tailwind, App Router, `src/` dir, alias `@/*`, ESLint); if it refuses the non-empty folder, move `docs/` aside and back. Install: `drizzle-orm drizzle-kit pg @types/pg zod @node-rs/argon2 vitest @playwright/test tsx dotenv`.
- [ ] **Step 2:** Add `docker-compose.yml` (postgres:16, port 5432) with `docker/init-db.sql` creating databases `billing` and `billing_test`. Add `.env.example` documenting both URLs. Configure Vitest projects (integration project sets `DATABASE_URL = DATABASE_URL_TEST` before importing `src/db/client.ts`) and Playwright (`webServer: npm run dev` with `DATABASE_URL_TEST`, base URL `http://localhost:3000`).
- [ ] **Step 3:** Write failing test `tests/e2e/smoke.spec.ts`: `GET /` shows a heading containing "Billing".
- [ ] **Step 4:** Run `docker compose up -d` then `npx playwright test tests/e2e/smoke.spec.ts`. Expected: FAIL (default Next page has no such heading).
- [ ] **Step 5:** Replace `src/app/page.tsx` with a heading "Billing". Re-run the smoke test. Expected: 1 passed. Run `npm run typecheck` and `npm run build`. Expected: both succeed.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "chore: scaffold Next.js, Postgres, Vitest, Playwright"`

---

### Task 2: Core libraries (types, errors, money, time, phone, password)

**Files:**
- Create: `src/lib/types.ts`, `src/lib/errors.ts`, `src/lib/money.ts`, `src/lib/time.ts`, `src/lib/phone.ts`, `src/modules/auth/password.ts`
- Test: `tests/unit/{errors,money,time,phone,password}.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `type Role = 'OWNER' | 'CASHIER'`; `interface AuthContext { shopId: string; userId: string; role: Role }`
  - `errors.ts`: `type ErrorCode = 'VALIDATION'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_FOUND'|'LOCKED'|'CONFLICT'|'PRICE_CHANGED'|'INVALID_PRODUCT'|'DISCOUNT_LIMIT'|'INSUFFICIENT_CASH'|'TOTAL_NOT_POSITIVE'|'ALREADY_CANCELLED'|'CANCEL_NOT_ALLOWED'|'INTERNAL'`; `class AppError extends Error { constructor(code: ErrorCode, message: string, details?: unknown) }`; `type ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } }`; `runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>>`
  - `money.ts`: `roundDiv(n: number, d: number): number` (half-up, `n >= 0`); `rupeesToPaise(input: string): number | null`; `percentToBp(input: string): number | null`; `formatPaise(paise: number): string`
  - `time.ts`: `businessDateFor(now: Date, timezone: string, dayStartHour: number): string` (`YYYY-MM-DD`); `financialYearOf(businessDate: string): string`; `formatBillNumber(prefix: string, fy: string, n: number): string`; `addDays(date: string, n: number): string`; `weekStartOf(date: string): string`; `monthRange(date: string): { from: string; to: string }`; `formatDateTimeIST(d: Date): string`
  - `phone.ts`: `normalizePhone(input: string | null | undefined): string | null`
  - `password.ts`: `hashPassword(plain: string): Promise<string>`; `verifyPassword(plain: string, hash: string): Promise<boolean>`

- [ ] **Step 1: Write failing tests** with these assertions:
  - `roundDiv(5,2)=3`, `roundDiv(4,2)=2`, `roundDiv(1,3)=0`.
  - `rupeesToPaise`: `'45'→4500`, `'12.5'→1250`, `'12.50'→1250`, `'₹1,200'→120000`, `' 7 '→700`, `'0.1'→10`; `null` for `'1.005'`, `''`, `'abc'`, `'-5'`, `'1e3'`, `'12.'`. (Review Focus 3)
  - `percentToBp`: `'10'→1000`, `'12.5'→1250`, `'100'→10000`; `null` for `'0'`, `'100.01'`, `'abc'`, `''`.
  - `formatPaise(4500)='₹45.00'`, `formatPaise(12345600)='₹1,23,456.00'`, `formatPaise(5)='₹0.05'`.
  - `businessDateFor` with `Asia/Kolkata`: `'2026-11-09T18:29:59Z', 0 → '2026-11-09'`; `'2026-11-09T19:00:00Z', 0 → '2026-11-10'`; `'2026-11-09T20:30:00Z', 4 → '2026-11-09'` (02:00 IST); `'2026-11-09T22:30:00Z', 4 → '2026-11-10'` (04:00 IST). (Review Focus 1)
  - `financialYearOf('2027-03-31')='2026-27'`, `('2027-04-01')='2027-28'`; `formatBillNumber('B','2026-27',123)='B-2627-000123'`; `formatBillNumber('B','2026-27',1234567)='B-2627-1234567'`.
  - `weekStartOf('2026-11-10')='2026-11-09'`, `weekStartOf('2026-11-08')='2026-11-02'`; `monthRange('2028-02-10')={from:'2028-02-01',to:'2028-02-29'}`; `addDays('2026-12-31',1)='2027-01-01'`.
  - `normalizePhone(' +91 98765-43210 ')='+919876543210'`; `''`, `null`, `undefined → null`; `'12ab'` and `'123'` throw `AppError` code `VALIDATION`.
  - `hashPassword` result differs from input and from a second hash of the same input; `verifyPassword` true for correct, false for wrong.
  - `runAction` returns `{ok:true,data}` on success, `{ok:false,error:{code,message}}` for `AppError`, and `{ok:false,error:{code:'INTERNAL',message:'Something went wrong'}}` for any other error (message must not leak the original).
- [ ] **Step 2:** Run `npx vitest run --project unit`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement each module with the signatures above. `businessDateFor`: shift `now` back by `dayStartHour` hours, then format the date in the given timezone with `Intl.DateTimeFormat('en-CA', …)`. `rupeesToPaise`/`percentToBp`: strip `₹`, commas and spaces, then match `^\d+(\.\d{1,2})?$`; parse by string splitting, not floating point. `formatPaise`: `Intl.NumberFormat('en-IN')` on whole rupees plus two-digit paise. Dates are plain `YYYY-MM-DD` strings; do date arithmetic in UTC.
- [ ] **Step 4:** Run `npx vitest run --project unit`. Expected: all PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: core libs for money, time, phone, errors, password"`

---

### Task 3: Bill totals calculation

**Files:**
- Create: `src/modules/billing/calc.ts`
- Test: `tests/unit/calc.test.ts`

**Interfaces:**
- Consumes: `roundDiv` (`money.ts`), `AppError`.
- Produces:
  ```ts
  type DiscountInput = { type: 'FLAT' | 'PERCENT'; value: number } | null   // FLAT: paise, PERCENT: basis points
  interface CalcInput { lines: { unitPricePaise: number; quantity: number }[]; discount: DiscountInput; gst: { enabled: boolean; rateBp: number; inclusive: boolean }; roundToRupee: boolean }
  interface Totals { subtotalPaise: number; discountPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; taxPaise: number; roundOffPaise: number; totalPaise: number }
  function calculateTotals(input: CalcInput): Totals
  ```
  Semantics: `net = subtotal - discount`. GST off: `tax = 0`, `taxable = net`. Exclusive: `tax = roundDiv(net*rateBp, 10000)`, `taxable = net`, `total = net + tax + roundOff`. Inclusive: `tax = net - roundDiv(net*10000, 10000+rateBp)`, `taxable = net - tax`, `total = net + roundOff`. `cgst = floor(tax/2)`, `sgst = tax - cgst`. Percent discount `= roundDiv(subtotal*value, 10000)`. `roundOff` rounds the pre-round total to the nearest 100 paise (half up) when `roundToRupee`, else 0.

- [ ] **Step 1: Write failing tests** (lines `[{1500,2},{1500,1}]` give subtotal 4500 unless stated):
  - GST off, no discount: subtotal 4500, discount 0, tax 0, total 4500.
  - PERCENT 1000 → discount 450, total 4050. FLAT 500 → discount 500, total 4000.
  - FLAT 4501 throws `VALIDATION`; FLAT 4500 throws `TOTAL_NOT_POSITIVE`; PERCENT 10000 throws `TOTAL_NOT_POSITIVE`; PERCENT 0 or 10001 throws `VALIDATION`.
  - Exclusive 500bp: tax 225, cgst 112, sgst 113, taxable 4500, total 4725.
  - Inclusive 500bp: tax 214, taxable 4286, cgst 107, sgst 107, total 4500.
  - FLAT 500 then exclusive 500bp: net 4000, tax 200, cgst 100, sgst 100, total 4200.
  - `roundToRupee`, GST off: subtotal 4150 → roundOff +50, total 4200; subtotal 4125 → roundOff -25, total 4100.
  - `roundToRupee`, exclusive 500bp on 4500: roundOff -25, total 4700.
  - Quantity 0, 1000, 1.5, and negative unit price throw `VALIDATION`; empty `lines` throws `VALIDATION`.
  - Invariant loop over 500 deterministic pseudo-random inputs: all fields are integers, `cgst+sgst===tax`, and `total` equals `subtotal - discount + (inclusive ? 0 : tax) + roundOff`.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/calc.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `calculateTotals` per the semantics above (validate inputs first; check `total > 0` after rounding).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: bill totals calculation with discount, GST and rounding"`

---

### Task 4: Database schema, migrations, test helpers, seed

**Files:**
- Create: `src/db/client.ts`, `src/db/schema/{shops,users,catalog,bills,sequences,audit}.ts`, `src/db/schema/index.ts`, `drizzle.config.ts`, `src/db/migrations/` (generated), `tests/helpers/db.ts`, `tests/helpers/global-setup.ts`, `scripts/seed.ts`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `AuthContext`.
- Produces: `db` (Drizzle over `pg.Pool`), `type Tx`, `type DbOrTx = typeof db | Tx`; schema exports `shops, shopSettings, users, sessions, categories, products, bills, billItems, payments, numberSequences, auditLogs`. Test helpers:
  ```ts
  interface TestUser { id: string; username: string; password: string; ctx: AuthContext }
  interface TestShop { shopId: string; owner: TestUser; cashier: TestUser; categoryId: string }
  resetDb(): Promise<void>                                   // truncates all tables
  makeShop(opts?: { settings?: Partial<typeof shopSettings.$inferInsert> }): Promise<TestShop>   // passwords 'owner-pass-123' / 'cashier-pass-123'
  makeProduct(shopId: string, p: { name: string; pricePaise: number; categoryId?: string; isActive?: boolean }): Promise<string>
  seedShop(env: { shopName: string; ownerUsername: string; ownerPassword: string }): Promise<void>   // exported from scripts/seed.ts, idempotent
  ```
- Columns follow spec section 6 exactly, plus the plan's additions: `sessions(id, user_id, token_hash unique, expires_at, created_at)`, `users.failed_attempts int default 0`, `users.locked_until timestamptz null`, `bills.tax_included boolean not null`, `bills.financial_year text not null` (e.g. `2026-27`; uniqueness is `UNIQUE(shop_id, financial_year, bill_number)` since bill numbers restart each financial year). `shop_settings` defaults: `paper_width 80`, `bill_prefix 'B'`, `token_reset_mode 'DAILY'`, `day_start_hour 0`, `gst_enabled false`, `gst_rate_bp 500`, `gst_inclusive true`, `receipt_title 'Tax Invoice'`, `round_to_rupee false`, `cashier_discount_max_pct_bp 0`, `cashier_discount_max_flat_paise 0`, `cashier_can_cancel false`, `receipt_header ''`, `receipt_footer 'Thank you! Visit again'`.
- Constraints: spec section 6 uniques (plus `unique(shop_id, lower(name))` on categories); CHECKs `quantity > 0`, `unit_price_paise >= 0`, `total_paise >= 0`, and `total_paise = subtotal_paise - discount_paise + CASE WHEN tax_included THEN 0 ELSE tax_paise END + round_off_paise`; `bill_items.product_id` has no cascade.

- [ ] **Step 1: Write failing tests** in `tests/integration/schema.test.ts` using raw inserts: duplicate `(shop_id, financial_year, bill_number)` rejected but the same bill number in another financial year accepted; duplicate `(shop_id, business_date, token_number)` rejected but the same token on a different date accepted; duplicate `(shop_id, idempotency_key)` rejected; `quantity = 0` rejected; a bill whose total does not match the formula rejected (both `tax_included` true and false variants accepted when correct); deleting a product row referenced by a bill item does not cascade-delete the item; `seedShop` called twice leaves exactly one shop and one owner.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/schema.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Define the schema files and `client.ts`; run `npm run db:generate` and commit the generated SQL; add `global-setup.ts` that runs migrations against `DATABASE_URL_TEST`; implement the helpers and `scripts/seed.ts` (`npm run seed` reads `SEED_SHOP_NAME`, `SEED_OWNER_USERNAME`, `SEED_OWNER_PASSWORD`, rejects passwords under 8 chars, exits quietly if a shop exists).
- [ ] **Step 4:** Run `npm run db:migrate:test` then the integration test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src scripts tests drizzle.config.ts && git commit -m "feat: database schema, migrations, test helpers, seed"`

---

### Task 5: Audit service

**Files:**
- Create: `src/modules/audit/service.ts`
- Test: `tests/integration/audit.test.ts`

**Interfaces:**
- Consumes: `DbOrTx`, `auditLogs`.
- Produces:
  ```ts
  type AuditAction = 'LOGIN_FAILED'|'LOGIN_LOCKED'|'BILL_CREATED'|'BILL_PRINTED'|'BILL_REPRINTED'|'BILL_CANCELLED'|'PRODUCT_CREATED'|'PRODUCT_UPDATED'|'PRODUCT_PRICE_CHANGED'|'PRODUCT_DISABLED'|'CATEGORY_CHANGED'|'SETTINGS_CHANGED'|'USER_CREATED'|'USER_PASSWORD_RESET'|'USER_DEACTIVATED'|'USER_REACTIVATED'
  recordAudit(executor: DbOrTx, e: { shopId: string; userId: string | null; action: AuditAction; entityType: string; entityId: string | null; meta?: Record<string, unknown> }): Promise<void>
  ```

- [ ] **Step 1: Write failing tests:** `recordAudit` inserts one row with the given fields and `meta` round-tripped; inside a `db.transaction` that is rolled back, no row remains.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/audit.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `recordAudit` (single insert on the passed executor).
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: audit log service"`

---

### Task 6: Authentication (sessions, login, lockout, guards)

**Files:**
- Create: `src/modules/auth/{session.ts,service.ts,guards.ts,actions.ts}`, `src/app/login/page.tsx`, `tests/e2e/global-setup.ts`, `tests/e2e/helpers.ts`
- Test: `tests/integration/auth.test.ts`, `tests/unit/guards.test.ts`, `tests/e2e/login.spec.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `recordAudit`, `makeShop`.
- Produces:
  ```ts
  const SESSION_TTL_HOURS = 12
  login(username: string, password: string, now?: Date): Promise<{ token: string; expiresAt: Date; ctx: AuthContext }>
  validateSession(token: string, now?: Date): Promise<AuthContext | null>
  logout(token: string): Promise<void>
  revokeUserSessions(userId: string): Promise<void>
  assertRole(ctx: AuthContext, roles: Role[]): void             // throws FORBIDDEN
  getCurrentContext(): Promise<AuthContext | null>              // reads cookie `session` via next/headers
  requireContext(roles?: Role[]): Promise<AuthContext>          // UNAUTHENTICATED / FORBIDDEN
  loginAction(formData: FormData), logoutAction()
  ```
  Cookie `session`: httpOnly, `Secure` in production, `SameSite=Strict`. Only a SHA-256 hash of the token is stored.

- [ ] **Step 1: Write failing tests:**
  - Integration: successful login returns ctx and a session row whose `token_hash` is not the raw token; wrong password and unknown username both throw `UNAUTHENTICATED` with the same message and write `LOGIN_FAILED` audit; 5 consecutive wrong passwords then a correct one throws `LOCKED` (audit `LOGIN_LOCKED`), the same login succeeds when `now` is 16 minutes later and resets `failed_attempts`; deactivated user cannot log in; `validateSession` returns null for a token 13 hours old, after `revokeUserSessions`, and after the user is deactivated while holding a live session (Review Focus 5).
  - Unit: `assertRole` throws `FORBIDDEN` for a cashier on `['OWNER']` and passes for an owner.
  - E2E (`global-setup.ts` resets the test DB and calls `makeShop`): wrong password shows "Invalid username or password"; valid owner login sets the `session` cookie and lands on a URL ending `/dashboard`; valid cashier login lands on `/billing`.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/auth.test.ts` and `npx vitest run --project unit tests/unit/guards.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the service (single-shop lookup: first row of `shops`), session helpers, guards and the login page (server action, no client JS required). Landing path after login: OWNER → `/dashboard`, CASHIER → `/billing`.
- [ ] **Step 4:** Run integration, unit and `npx playwright test tests/e2e/login.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: authentication with sessions, lockout and role guards"`

---

### Task 7: App shell and role-based navigation

**Files:**
- Create: `src/modules/auth/nav.ts`, `src/app/(app)/layout.tsx`, placeholder pages `(app)/{billing,bills,products,reports,dashboard,settings}/page.tsx`
- Test: `tests/unit/nav.test.ts`, `tests/e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: `requireContext`, `logoutAction`.
- Produces: `navItemsForRole(role: Role): { label: string; href: string }[]` (OWNER: Billing, Bills, Products, Reports, Dashboard, Settings in that order; CASHIER: Billing, Bills); `landingPathFor(role: Role): string`. Owner-only pages call `requireContext(['OWNER'])`.

- [ ] **Step 1: Write failing tests:** unit tests for the two functions with the exact lists above; e2e: cashier sees only Billing and Bills in the nav and visiting `/products`, `/reports`, `/dashboard`, `/settings` does not render those pages (redirect to `/billing`); owner sees all six; unauthenticated visit to `/billing` redirects to `/login`; Logout clears the session.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/nav.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the nav helpers and the `(app)` layout (left rail on desktop/tablet, top bar on narrow screens; touch targets at least 44px). Placeholder pages show their title.
- [ ] **Step 4:** Run the unit test and `npx playwright test tests/e2e/navigation.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: app shell with role-based navigation"`

---

### Task 8: Shop and settings

**Files:**
- Create: `src/modules/shop/{schema.ts,service.ts,actions.ts}`, settings UI under `src/app/(app)/settings/` (tabs: Shop, Numbering, GST, Discounts, Receipt text)
- Test: `tests/integration/settings.test.ts`, `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `AuthContext`, `recordAudit`, `AppError`, `rupeesToPaise`, `percentToBp`.
- Produces:
  ```ts
  interface BillingConfig { gstEnabled: boolean; gstRateBp: number; gstInclusive: boolean; roundToRupee: boolean; paperWidth: 58 | 80; cashierDiscountMaxPctBp: number; cashierDiscountMaxFlatPaise: number; cashierCanCancel: boolean; receiptTitle: string }
  getBillingConfig(ctx: AuthContext): Promise<BillingConfig>                 // OWNER or CASHIER
  getSettings(ctx: AuthContext): Promise<{ shop: ShopInfo; settings: ShopSettingsRow }>   // OWNER only
  updateSettings(ctx: AuthContext, patch: SettingsPatch): Promise<void>      // OWNER only; Zod `settingsPatchSchema`
  ```
  Validation: `paperWidth ∈ {58,80}`; `gstRateBp 0-10000`; `dayStartHour 0-23`; `billPrefix` 1-6 chars `[A-Z0-9]`; GSTIN optional, 15 chars matching `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`; shop name 1-80 chars; receipt header/footer at most 200 chars.

- [ ] **Step 1: Write failing tests:** cashier `updateSettings` throws `FORBIDDEN`; cashier `getBillingConfig` succeeds, cashier `getSettings` throws `FORBIDDEN`; each invalid value above throws `VALIDATION`; a valid update persists and writes one `SETTINGS_CHANGED` audit row whose `meta.changed` lists only the changed keys; an update changing nothing writes no audit; other shops' settings are untouched. E2E: owner changes the GST rate and shop name in the UI, reloads, values persist.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the Zod schema, service and actions. UI: percent and rupee inputs use `percentToBp` / `rupeesToPaise` and show validation errors inline.
- [ ] **Step 4:** Run the integration test and `npx playwright test tests/e2e/settings.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: shop settings with validation and audit"`

---

### Task 9: Categories and products

**Files:**
- Create: `src/modules/catalog/{schema.ts,service.ts,actions.ts}`, `src/app/(app)/products/page.tsx` and components
- Test: `tests/integration/catalog.test.ts`, `tests/e2e/products.spec.ts`

**Interfaces:**
- Consumes: `AuthContext`, `recordAudit`, `rupeesToPaise`, `makeShop`.
- Produces:
  ```ts
  interface CategoryRow { id: string; name: string; sortOrder: number; isActive: boolean }
  interface ProductRow { id: string; categoryId: string; name: string; pricePaise: number; shortCode: string | null; sortOrder: number; isActive: boolean }
  listCategories(ctx, opts?: { includeInactive?: boolean }): Promise<CategoryRow[]>          // any role
  createCategory(ctx, i: { name: string; sortOrder?: number }): Promise<CategoryRow>           // OWNER
  updateCategory(ctx, id: string, patch: { name?: string; sortOrder?: number }): Promise<CategoryRow>
  setCategoryActive(ctx, id: string, active: boolean): Promise<void>
  listProducts(ctx, q?: { categoryId?: string; search?: string; includeInactive?: boolean }): Promise<ProductRow[]>   // any role; never returns soft-deleted
  createProduct(ctx, i: { name: string; categoryId: string; pricePaise: number; shortCode?: string; sortOrder?: number }): Promise<ProductRow>   // OWNER
  updateProduct(ctx, id: string, patch: Partial<{ name: string; categoryId: string; pricePaise: number; shortCode: string | null; sortOrder: number }>): Promise<ProductRow>
  setProductActive(ctx, id: string, active: boolean): Promise<void>
  deleteProduct(ctx, id: string): Promise<void>                                              // soft delete
  ```
  Validation: name 1-60 chars trimmed; `pricePaise` integer `0-10_000_000`; short code optional, 1-10 chars `[A-Za-z0-9]`.

- [ ] **Step 1: Write failing tests:** shop B's ctx gets `NOT_FOUND` updating shop A's product and sees none of its products; cashier can `listProducts` (active only by default) but `createProduct` throws `FORBIDDEN`; soft-deleted products never listed even with `includeInactive`; `setProductActive(false)` hides it from the default list and shows it with `includeInactive`; `updateProduct` with a changed price writes `PRODUCT_PRICE_CHANGED` with `meta {from,to}`; disabling writes `PRODUCT_DISABLED`; search matches name case-insensitively as a substring and short code exactly; duplicate category name in the same shop (case-insensitive) throws `CONFLICT`; invalid price (`-1`, `10_000_001`, `12.5`) throws `VALIDATION`. E2E: owner adds category "Tea" and product "Masala Tea" with price text `15` through the form; it appears in the list; toggling the switch disables it.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/catalog.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement services and the Products page (category list, editable table, enable/disable switch, add/edit slide-over; price field parsed with `rupeesToPaise`, blank or invalid shows an inline error).
- [ ] **Step 4:** Run the integration test and `npx playwright test tests/e2e/products.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: category and product management"`

---

### Task 10: Number sequences and `createBill`

**Files:**
- Create: `src/modules/billing/{sequences.ts,schema.ts,service.ts}`, `src/modules/bills/{types.ts,repo.ts}`
- Modify: `src/modules/shop/service.ts` (call `syncTokenSequence` when `tokenResetMode` changes)
- Test: `tests/integration/create-bill.test.ts`

**Interfaces:**
- Consumes: `calculateTotals`, `businessDateFor`, `financialYearOf`, `formatBillNumber`, `normalizePhone`, `recordAudit`, `getBillingConfig`, schema tables, `makeShop`, `makeProduct`.
- Produces:
  ```ts
  nextSequenceValue(tx: Tx, shopId: string, key: string): Promise<number>     // single-statement INSERT … ON CONFLICT DO UPDATE last_value = last_value + 1 RETURNING; first value is 1
  syncTokenSequence(tx: Tx, shopId: string, mode: 'DAILY' | 'NEVER', businessDate: string): Promise<void>   // raises the active key to the max token already issued (all time for NEVER, that date for DAILY)
  // keys: `bill:<financialYear>`; `token:<businessDate>` (DAILY) or `token:all` (NEVER)

  interface CreateBillInput { idempotencyKey: string /* uuid */; items: { productId: string; quantity: number; expectedUnitPricePaise: number }[]; discount: { type: 'FLAT'|'PERCENT'; value: number } | null; expectedTotalPaise: number /* displayed total, compared only */; payment: { method: 'CASH'; cashTenderedPaise: number } | { method: 'UPI'; confirmed: true; reference?: string }; customerName?: string; customerPhone?: string }
  interface BillItemRow { productName: string; categoryName: string; unitPricePaise: number; quantity: number; lineTotalPaise: number }
  interface BillDetail { id: string; billNumber: number; billNumberDisplay: string; tokenNumber: number; businessDate: string; status: 'COMPLETED'|'CANCELLED'; createdAt: Date; items: BillItemRow[]; subtotalPaise: number; discountType: 'FLAT'|'PERCENT'|null; discountValue: number; discountPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; taxPaise: number; taxIncluded: boolean; roundOffPaise: number; totalPaise: number; payment: { method: 'CASH'|'UPI'; amountPaise: number; cashTenderedPaise: number | null; changePaise: number | null; upiReference: string | null; status: 'RECORDED'|'VOIDED' }; customerName: string | null; customerPhone: string | null; printCount: number; cancelledAt: Date | null; cancelReason: string | null; shopSnapshot: { name: string; address: string; phone: string; gstin: string | null }; gstSnapshot: { enabled: boolean; rateBp: number; inclusive: boolean; title: string } }
  createBill(ctx: AuthContext, input: CreateBillInput, now?: Date): Promise<BillDetail>
  getBillDetail(executor: DbOrTx, shopId: string, billId: string): Promise<BillDetail | null>   // in bills/repo.ts
  ```
  `expectedUnitPricePaise` is compared with the current catalog price and **never used for calculation**. Cashier discount limits: PERCENT value `<= cashierDiscountMaxPctBp`, FLAT value `<= cashierDiscountMaxFlatPaise`, else `DISCOUNT_LIMIT`. All validation, price checks and `calculateTotals` happen before the transaction opens; the transaction does: idempotency lookup → bill counter → token counter → inserts (bill, items with name/price snapshots, payment, `BILL_CREATED` audit) → commit.

- [ ] **Step 1: Write failing tests** (use `now` to control time; FY 2026-27 date for display checks):
  - First bill: `billNumber 1`, `tokenNumber 1`, `billNumberDisplay 'B-2627-000001'`; items snapshot names and prices; cash payment stores tendered and change; second bill is `2/2`.
  - Next business day: token restarts at 1, bill number continues. `tokenResetMode NEVER`: token continues across days.
  - Bill at `2026-11-09T18:29:59Z` (23:59:59 IST) has `businessDate 2026-11-09`; at `19:00:00Z` it has `2026-11-10` and token 1 (Review Focus 1). With `dayStartHour 4`, 02:00 IST belongs to the previous date.
  - Same idempotency key twice returns the same bill id, one `bills` row, counters still at 1 (Review Focus 2).
  - `PRICE_CHANGED` when `expectedUnitPricePaise` differs; no bill row, and the next valid bill gets number 1 and token 1. `INSUFFICIENT_CASH` leaves no number consumed likewise.
  - `INVALID_PRODUCT` for an inactive, soft-deleted, and other-shop product.
  - Cashier discount over the limit, and any discount at the default limit 0, throws `DISCOUNT_LIMIT`; within a configured limit succeeds; owner is unlimited.
  - UPI with `confirmed` missing or false throws `VALIDATION`; UPI payment `amountPaise === total`, `cashTenderedPaise null`.
  - After changing the product's name and price, `getBillDetail` still shows the original name and price. After changing the shop name and GST settings, `shopSnapshot` and `gstSnapshot` are unchanged.
  - GST exclusive 500bp: stored `taxPaise`, `cgstPaise`, `sgstPaise`, `taxIncluded false`, total matches `calculateTotals`.
  - `customerPhone ' +91 98765 43210 '` stored as `+919876543210`; `''` stored as null; `'abc'` throws `VALIDATION`.
  - 50 parallel `createBill` calls produce bill numbers exactly 1..50 and tokens exactly 1..50 with no failures.
  - `BILL_CREATED` audit row exists. Switching mode DAILY → NEVER → DAILY mid-day via `updateSettings` never produces a duplicate token for the rest of the day.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/create-bill.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `sequences.ts` (raw SQL through Drizzle `sql`), the Zod input schema (quantity 1-999 integers, customer name max 60 chars, UPI reference max 40 chars), `bills/repo.ts`, `createBill`, and the `updateSettings` hook for `syncTokenSequence`.
- [ ] **Step 4:** Run the integration test. Expected: PASS (including the 50-parallel test).
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: atomic bill and token numbering with createBill"`

---

### Task 11: Receipt model and HTML renderers

**Files:**
- Create: `src/modules/printing/{receipt.ts,render-html.ts}`
- Test: `tests/unit/receipt.test.ts`

**Interfaces:**
- Consumes: `BillDetail`, `formatPaise`, `formatDateTimeIST`.
- Produces:
  ```ts
  interface ReceiptData { isSample: boolean; isReprint: boolean; status: 'COMPLETED'|'CANCELLED'; shop: { name: string; address: string; phone: string; gstin: string | null }; title: string; header: string; footer: string; billNumberDisplay: string; tokenNumber: number; dateTime: string; items: { name: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }[]; subtotalPaise: number; discountPaise: number; gst: null | { inclusive: boolean; rateBp: number; taxablePaise: number; cgstPaise: number; sgstPaise: number }; roundOffPaise: number; totalPaise: number; paymentMethod: 'CASH'|'UPI'; cashTenderedPaise: number | null; changePaise: number | null; customerName: string | null }
  buildReceiptData(bill: BillDetail, text: { header: string; footer: string }, opts: { isReprint: boolean }): ReceiptData   // shop/GST details come from the bill's snapshots, not current settings
  renderReceiptHtml(data: ReceiptData, paperWidth: 58 | 80): string                                                      // complete HTML document
  ```
  Layout: `@page { size: <w>mm auto; margin: 0 }`; body width `48mm` (58) or `72mm` (80); monospace; token in an element with class `token` in large type near the top; item names use `overflow-wrap: anywhere`.

- [ ] **Step 1: Write failing tests:** token and bill number present, token inside `.token`; 58 output contains `size: 58mm auto` and `48mm`, 80 output contains `size: 80mm auto` and `72mm`; a product named `<script>alert(1)</script> & "x"` appears escaped (`&lt;script&gt;`, `&amp;`, `&quot;`) and never as raw `<script>`; customer name with the same content is escaped likewise; a 150-character name and an emoji name render without throwing and include the overflow-wrap rule (Review Focus 4); CGST/SGST lines appear only when `gst` is non-null; discount line only when `discountPaise > 0`; `status CANCELLED` shows "CANCELLED"; `isReprint` shows "REPRINT"; `isSample` shows "TEST PRINT - NOT A BILL"; cash shows tendered and change, UPI shows neither; shop name comes from `shopSnapshot` even when current settings differ.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/receipt.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement both functions; one shared `escapeHtml`; amounts formatted with `formatPaise`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: receipt model and 58/80mm HTML renderers"`

---

### Task 12: Bills service (list, get, cancel, print recording)

**Files:**
- Create: `src/modules/bills/{service.ts,actions.ts}`, `src/modules/printing/service.ts`
- Test: `tests/integration/bills.test.ts`

**Interfaces:**
- Consumes: `getBillDetail`, `createBill`, `getBillingConfig`, `buildReceiptData`, `renderReceiptHtml`, `recordAudit`, `businessDateFor`.
- Produces:
  ```ts
  interface BillQuery { search?: string; date?: string; from?: string; to?: string; status?: 'COMPLETED'|'CANCELLED'; method?: 'CASH'|'UPI'; page?: number; pageSize?: number }
  interface BillListRow { id: string; billNumberDisplay: string; tokenNumber: number; businessDate: string; createdAt: Date; status: 'COMPLETED'|'CANCELLED'; totalPaise: number; paymentMethod: 'CASH'|'UPI' }
  listBills(ctx, q: BillQuery, now?: Date): Promise<{ rows: BillListRow[]; total: number }>   // cashier is forced to today's business date; all-digit search = exact token (within the date filter), otherwise ILIKE on bill_number_display
  getBill(ctx, billId: string, now?: Date): Promise<BillDetail>                                  // cashier: today only, else NOT_FOUND; other shop: NOT_FOUND
  cancelBill(ctx, billId: string, reason: string, now?: Date): Promise<BillDetail>
  recordPrint(ctx, billId: string, now?: Date): Promise<{ isReprint: boolean; printCount: number }>
  prepareReceiptPrint(ctx, billId: string, now?: Date): Promise<{ html: string; isReprint: boolean }>   // in printing/service.ts; calls recordPrint
  ```
  Cancel rules: OWNER always; CASHIER only when `cashierCanCancel` (else `FORBIDDEN`) and the bill's business date is today (else `CANCEL_NOT_ALLOWED`); reason trimmed, 3-200 chars (`VALIDATION`); already cancelled → `ALREADY_CANCELLED`. Cancel sets status, who/when/reason, payment `VOIDED`, audit `BILL_CANCELLED`, in one transaction. `recordPrint` increments `print_count` atomically (`print_count = print_count + 1`), sets `last_printed_at`, audit `BILL_PRINTED` when the previous count was 0 else `BILL_REPRINTED`; it works for cancelled bills.

- [ ] **Step 1: Write failing tests:** cashier list never returns yesterday's bills even when `date` is passed; owner can filter by date, status, method; search `'3'` finds token 3 and `'000002'` finds that bill number; cashier `getBill` on yesterday's bill and cross-shop bill both `NOT_FOUND`; owner cancels: status CANCELLED, payment VOIDED, row still listed and retrievable, `BILL_CANCELLED` audited with reason; empty or 2-character reason → `VALIDATION`; second cancel → `ALREADY_CANCELLED`; cashier cancel with setting off → `FORBIDDEN`, with setting on same day succeeds, with setting on for yesterday's bill → `CANCEL_NOT_ALLOWED`; `number_sequences` rows identical before and after a cancel and after reprints; first `recordPrint` → `{isReprint:false, printCount:1}` with `BILL_PRINTED`, second → `{true, 2}` with `BILL_REPRINTED`; `prepareReceiptPrint` HTML contains "REPRINT" only from the second call and contains "CANCELLED" for a cancelled bill.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/bills.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the services and thin actions wrapped in `runAction`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: bill history, cancel and print recording"`

---

### Task 13: Cart reducer

**Files:**
- Create: `src/modules/billing/cart.ts`
- Test: `tests/unit/cart.test.ts`

**Interfaces:**
- Consumes: `calculateTotals`, `BillingConfig`.
- Produces:
  ```ts
  interface CartLine { productId: string; name: string; unitPricePaise: number; quantity: number }
  interface CartState { lines: CartLine[]; discount: { type: 'FLAT'|'PERCENT'; value: number } | null; idempotencyKey: string }
  type CartAction = { type: 'ADD_PRODUCT'; product: { id: string; name: string; pricePaise: number } } | { type: 'SET_QUANTITY'; productId: string; quantity: number } | { type: 'REMOVE'; productId: string } | { type: 'SET_DISCOUNT'; discount: CartState['discount'] } | { type: 'REFRESH_PRICES'; prices: Record<string, number> } | { type: 'RESET' }
  initialCart(newKey: () => string): CartState
  cartReducer(state: CartState, action: CartAction, newKey: () => string): CartState
  selectTotals(state: CartState, cfg: Pick<BillingConfig, 'gstEnabled'|'gstRateBp'|'gstInclusive'|'roundToRupee'>): Totals | null   // null when the cart is empty or invalid
  ```

- [ ] **Step 1: Write failing tests:** adding the same product twice gives quantity 2 on one line; `SET_QUANTITY` to 0 removes the line; quantity above 999 is clamped to 999; `REMOVE` drops the line; the idempotency key is unchanged by every action except `RESET`, which clears lines/discount and generates a new key; `REFRESH_PRICES` updates only the listed lines; `selectTotals` is null for an empty cart and matches `calculateTotals` otherwise.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/cart.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the pure reducer (no `crypto` calls inside; key generator is injected).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: cart reducer"`

---

### Task 14: Billing screen, charge, success screen, print

**Files:**
- Create: `src/modules/billing/actions.ts`, `src/modules/printing/print-client.ts`, `src/app/(app)/billing/{page.tsx,BillingClient.tsx,ProductGrid.tsx,CartPanel.tsx,PaymentPanel.tsx,SuccessScreen.tsx}`
- Test: `tests/e2e/billing.spec.ts`

**Interfaces:**
- Consumes: `createBill`, `prepareReceiptPrint`, `cartReducer`, `selectTotals`, `getBillingConfig`, `listCategories`, `listProducts`, `rupeesToPaise`, `percentToBp`, `runAction`.
- Produces:
  ```ts
  createBillAction(input: unknown): Promise<ActionResult<BillDetail>>     // billing/actions.ts; Zod-parses, calls createBill with the session ctx
  printReceiptHtml(html: string): Promise<void>                           // print-client.ts: hidden iframe, srcdoc, print() on load, cleanup on afterprint or after 60 s; if `window.__PRINT_HOOK__` is defined it is called with the html instead (test seam)
  printBillAction(billId: string): Promise<ActionResult<{ html: string; isReprint: boolean }>>   // wraps prepareReceiptPrint
  ```
  UI contract: product tiles left (search, category chips), cart right; payable amount prominent; Cash/UPI toggle; cash quick buttons Exact, 50, 100, 200, 500; UPI requires a "Payment received" checkbox, optional reference; optional customer fields behind a small link; discount control (flat in rupees, or percent); **Charge disabled while a request is pending**; success screen with large token number, bill number, total, Print and New Bill; shortcuts `/` (focus search), Enter (add top result), Ctrl+Enter (charge), Esc (clear cart with confirmation). On `PRICE_CHANGED`, refresh catalog prices into the cart and show a message instead of charging. No auto-print.

- [ ] **Step 1: Write failing e2e tests** (global setup seeds products Masala Tea ₹15 and Samosa ₹15): cashier adds Masala Tea twice and Samosa once, chooses Cash, taps Exact, Charge → success shows token `1` and `B-` bill number ending `000001`, total ₹45.00; New Bill resets the cart and focuses search; Print calls the hook exactly once with HTML containing the token and (second Print click) "REPRINT" after the first; double-clicking Charge creates exactly one bill (check via the Bills page or DB); UPI cannot be charged until "Payment received" is ticked; typing `12.5.5` in cash tendered shows an inline error and blocks Charge (Review Focus 3); after the test changes a product price in the DB between add and Charge, the UI shows a prices-changed message, updates the cart price, and no bill exists; Ctrl+Enter charges, Esc asks for confirmation before clearing.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/billing.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the actions, print client and screens. The page is a server component loading config, categories and products; `BillingClient` holds the reducer state and generates a new idempotency key on mount and on New Bill.
- [ ] **Step 4:** Run the e2e file. Expected: PASS. Run `npm run typecheck`.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: billing screen with charge, success screen and manual print"`

---

### Task 15: Bill history UI (search, detail, reprint, cancel)

**Files:**
- Create: `src/app/(app)/bills/{page.tsx,BillsTable.tsx,BillDrawer.tsx}`
- Test: `tests/e2e/bills.spec.ts`

**Interfaces:**
- Consumes: `listBills`, `getBill`, `cancelBill`, `printBillAction`, `printReceiptHtml`, `getBillingConfig`.
- Produces: `/bills` page with search box, date filter (owner only; cashier fixed to today), status and method filters, paged table, detail drawer (items, totals, payment, customer, cancel info) with Reprint, and Cancel (hidden when the user may not cancel) opening a dialog that requires a reason.

- [ ] **Step 1: Write failing e2e tests:** after creating two bills, searching a token number finds that bill and searching a bill number finds it; opening a bill shows items, payment and total; Reprint calls the print hook with HTML containing "REPRINT" and the bill's token, and the bill's print count increases while the bill count and tokens do not change; owner cancels with a reason → row shows a CANCELLED badge and stays listed; the Cancel button is absent for a cashier when the setting is off; the cashier's date filter is not available.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/bills.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the page, table and drawer.
- [ ] **Step 4:** Run the e2e file. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: bill history UI with reprint and cancel"`

---

### Task 16: Receipt preview and test print (Settings)

**Files:**
- Create: `src/modules/printing/sample.ts`, `src/app/(app)/settings/ReceiptTab.tsx`
- Test: `tests/unit/sample.test.ts`, `tests/e2e/receipt-settings.spec.ts`

**Interfaces:**
- Consumes: `renderReceiptHtml`, `printReceiptHtml`, `getSettings`.
- Produces: `sampleReceiptData(shop: ShopInfo, text: { header: string; footer: string }): ReceiptData` (`isSample: true`, fixed items and totals, no DB access). Receipt tab shows a live preview iframe (`srcdoc`) for the selected paper width, a paper width selector (58/80, saved via `updateSettings`), header/footer text, and a Test Print button.

- [ ] **Step 1: Write failing tests:** unit: `sampleReceiptData` returns `isSample true`, totals consistent (`totalPaise` equals sum of line totals minus discount), and uses the passed shop name; e2e: changing paper width to 58 updates the preview (contains `size: 58mm`), Test Print calls the print hook with a document containing "TEST PRINT - NOT A BILL", and the bills count is unchanged afterwards.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/sample.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the sample builder and the tab.
- [ ] **Step 4:** Run the unit test and `npx playwright test tests/e2e/receipt-settings.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: receipt preview and test print"`

---

### Task 17: Reports service and CSV

**Files:**
- Create: `src/modules/reports/{service.ts,csv.ts,actions.ts}`
- Test: `tests/integration/reports.test.ts`, `tests/unit/csv.test.ts`

**Interfaces:**
- Consumes: schema tables, `createBill`, `cancelBill`, `weekStartOf`, `monthRange`, `addDays`, `businessDateFor`, `formatPaise`.
- Produces:
  ```ts
  interface DateRange { from: string; to: string }                         // inclusive business dates
  rangeForPeriod(period: 'day'|'week'|'month', anchor: string): DateRange
  interface SalesSummary { grossSalesPaise: number; discountPaise: number; gstPaise: number; totalPaise: number; billCount: number; avgBillPaise: number; cashPaise: number; upiPaise: number; cancelledCount: number; cancelledPaise: number }
  interface DailyRow { businessDate: string; billCount: number; totalPaise: number; cashPaise: number; upiPaise: number; discountPaise: number; gstPaise: number }
  getSalesSummary(ctx, range: DateRange): Promise<SalesSummary>            // OWNER only; COMPLETED bills with RECORDED payments; gross = Σ subtotal, total = Σ total
  getDailyBreakdown(ctx, range: DateRange): Promise<DailyRow[]>
  getTopItems(ctx, range: DateRange, limit?: number): Promise<{ productName: string; quantity: number; amountPaise: number }[]>   // default limit 10
  getDashboard(ctx, now?: Date): Promise<{ today: SalesSummary; recent: BillListRow[] }>                                         // last 10 bills overall
  buildReportCsv(rows: { businessDate: string; billNumberDisplay: string; tokenNumber: number; status: string; subtotalPaise: number; discountPaise: number; gstPaise: number; totalPaise: number; paymentMethod: string }[], summary: SalesSummary): string
  getBillsForCsv(ctx, range: DateRange): Promise<Parameters<typeof buildReportCsv>[0]>
  ```
  CSV: header row, one row per bill (amounts as rupees with two decimals, e.g. `45.00`), blank line, then a summary section. Fields containing commas, quotes or newlines are quoted per RFC 4180.

- [ ] **Step 1: Write failing tests:** seed bills over several days (cash and UPI, discounts, GST) with one cancelled bill: summary excludes the cancelled bill's amounts and reports `cancelledCount 1` and `cancelledPaise`; cash plus UPI equals total; daily breakdown groups by `businessDate`; `rangeForPeriod('week','2026-11-10') = {2026-11-09, 2026-11-15}`; `rangeForPeriod('month','2026-02-15') = {2026-02-01, 2026-02-28}`; a bill at 23:30 IST counts on its own date; with `dayStartHour 4` a 02:00 IST bill is counted on the previous date (Review Focus 1); top items sorted by amount; cashier calling any report function gets `FORBIDDEN`; another shop's bills never counted. CSV unit tests: quoting of a value containing a comma and a quote, `4500 → "45.00"`, summary section present.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/reports.test.ts` and `npx vitest run --project unit tests/unit/csv.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with explicit SQL aggregates grouped by `business_date` and a payment join.
- [ ] **Step 4:** Run both. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: sales reports, dashboard data and CSV export"`

---

### Task 18: Dashboard and Reports pages

**Files:**
- Create: `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/reports/{page.tsx,export/route.ts}`
- Test: `tests/e2e/reports.spec.ts`

**Interfaces:**
- Consumes: `getDashboard`, `getSalesSummary`, `getDailyBreakdown`, `getTopItems`, `rangeForPeriod`, `getBillsForCsv`, `buildReportCsv`, `formatPaise`.
- Produces: Dashboard (today's sales, bill count, cash vs UPI, cancelled count, last 10 bills); Reports with Day / Week / Month tabs, date picker, summary cards, cash/UPI split, per-day table, top items, cancelled summary and an Export CSV link to `/reports/export?period=&date=` (OWNER only, `Content-Type: text/csv`, `Content-Disposition` filename `sales-<from>-to-<to>.csv`).

- [ ] **Step 1: Write failing e2e tests:** after creating a cash bill (₹45), a UPI bill (₹30) and cancelling a third, the Dashboard shows total ₹75.00, 2 bills, cash ₹45.00, UPI ₹30.00, 1 cancelled; the Reports Day tab shows the same figures; the CSV download contains both bills, excludes nothing silently (cancelled row present with status CANCELLED) and the summary total ₹75.00; a cashier requesting `/reports/export` is refused.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/reports.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the pages and route handler.
- [ ] **Step 4:** Run the e2e file. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: dashboard and reports pages with CSV download"`

---

### Task 19: User management

**Files:**
- Create: `src/modules/users/{service.ts,actions.ts}`, Settings "Users" tab
- Test: `tests/integration/users.test.ts`, `tests/e2e/users.spec.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `revokeUserSessions`, `recordAudit`, `login`, `validateSession`.
- Produces:
  ```ts
  interface UserRow { id: string; name: string; username: string; role: Role; isActive: boolean; createdAt: Date }
  listUsers(ctx): Promise<UserRow[]>                                                          // OWNER
  createCashier(ctx, i: { name: string; username: string; password: string }): Promise<UserRow>
  resetPassword(ctx, userId: string, newPassword: string): Promise<void>                      // CASHIER targets only; revokes their sessions; clears lockout
  setUserActive(ctx, userId: string, active: boolean): Promise<void>                          // CASHIER targets only; deactivation revokes sessions
  changeOwnPassword(ctx, current: string, next: string): Promise<void>                        // verifies current; revokes all of the user's sessions
  ```
  Validation: username 3-32 chars `[a-z0-9._-]` (lowercased), password 8-128 chars, name 1-60 chars.

- [ ] **Step 1: Write failing tests:** cashier calling any of these gets `FORBIDDEN`; `createCashier` writes `USER_CREATED`; duplicate username → `CONFLICT`; short password or bad username → `VALIDATION`; `resetPassword` lets the cashier log in with the new password and not the old, writes `USER_PASSWORD_RESET`, and a session created before the reset no longer validates (Review Focus 5); `setUserActive(false)` blocks login, invalidates a live session, writes `USER_DEACTIVATED`, and reactivation restores login (`USER_REACTIVATED`); targeting the owner (including self) throws `FORBIDDEN`; `changeOwnPassword` with a wrong current password throws `UNAUTHENTICATED`, with the right one revokes sessions. E2E: owner creates a cashier, that cashier logs in, owner deactivates them, their next page load goes to `/login`.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/users.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement services, actions and the Users tab (create form, reset-password and deactivate buttons, own-password form).
- [ ] **Step 4:** Run the integration test and `npx playwright test tests/e2e/users.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: user management"`

---

### Task 20: Audit log viewer

**Files:**
- Modify: `src/modules/audit/service.ts`
- Create: Settings "Audit log" tab
- Test: `tests/integration/audit-list.test.ts`

**Interfaces:**
- Produces: `listAudit(ctx, q: { from?: string; to?: string; action?: AuditAction; page?: number; pageSize?: number }): Promise<{ rows: { id: string; createdAt: Date; userName: string | null; action: AuditAction; entityType: string; entityId: string | null; meta: Record<string, unknown> }[]; total: number }>` (OWNER only, newest first, own shop only; dates are business dates in IST).

- [ ] **Step 1: Write failing tests:** cashier gets `FORBIDDEN`; rows come newest first; `action` filter works; date filter uses IST dates; another shop's rows never appear; pagination returns `total` across pages.
- [ ] **Step 2:** Run `npx vitest run --project integration tests/integration/audit-list.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `listAudit` and the read-only tab (table with filters).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src tests && git commit -m "feat: audit log viewer"`

---

### Task 21: Backups and restore drill

**Files:**
- Create: `scripts/backup.ts`, `scripts/restore-check.ts`, `docs/ops/backup-restore.md`
- Test: `tests/unit/backup.test.ts`

**Interfaces:**
- Produces: `backupFileName(now: Date): string` → `billing-YYYYMMDD-HHmm.dump` (UTC); `selectExpired(files: string[], now: Date, keepDays?: number): string[]` (default 30; ignores names that do not match the pattern); `npm run backup` (runs `$PG_DUMP_BIN` (default `pg_dump`) with `-Fc` into `BACKUP_DIR`, prunes expired files); `npm run backup:verify` (restores the newest dump into a scratch database with `pg_restore`, compares counts of `bills` and `payments` to the source, prints `restore OK: bills=<n> payments=<n>` and drops the scratch DB).

- [ ] **Step 1: Write failing unit tests:** `backupFileName(new Date('2026-11-10T03:05:00Z')) = 'billing-20261110-0305.dump'`; `selectExpired` returns files older than 30 days relative to `now`, keeps newer ones, and ignores `notes.txt`.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/backup.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the two pure functions and the scripts; document the managed point-in-time recovery setting, the nightly schedule, off-site copy and the quarterly drill in `docs/ops/backup-restore.md`.
- [ ] **Step 4:** Run the unit test (PASS). Then with the dev database running: `npm run backup && npm run backup:verify`. Expected: output `restore OK: bills=<n> payments=<n>` with counts equal to the source.
- [ ] **Step 5:** Commit: `git add scripts docs src tests && git commit -m "feat: backup and restore verification scripts"`

---

### Task 22: Hardening and deployment

**Files:**
- Create: `src/lib/env.ts`, `src/app/api/health/route.ts`, `docs/ops/runbook.md`
- Modify: `next.config.ts` (security headers)
- Test: `tests/unit/env.test.ts`, `tests/e2e/hardening.spec.ts`

**Interfaces:**
- Produces: `parseEnv(raw: Record<string, string | undefined>): { DATABASE_URL: string; NODE_ENV: 'development'|'test'|'production' }` (Zod; throws listing every missing or invalid variable); `GET /api/health` → `200 {"status":"ok"}` when the DB answers, else `503`; headers on all routes: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, and `Strict-Transport-Security` in production.

- [ ] **Step 1: Write failing tests:** `parseEnv({})` throws mentioning `DATABASE_URL`; valid input returns typed values; e2e: `/api/health` returns 200 with `{"status":"ok"}`; any page response carries the three headers above.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/env.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement env parsing (used by `db/client.ts`), the health route, headers and the runbook (first-run seed, outage procedure: phone hotspot then paper bill book, Windows `--kiosk-printing` shortcut as an optional setup, backup schedule, restore steps, who to call).
- [ ] **Step 4:** Run the unit test and `npx playwright test tests/e2e/hardening.spec.ts`. Expected: PASS.
- [ ] **Step 5:** **Ask the user which host to use** (a managed Next.js platform plus managed PostgreSQL in an Indian region, or a VPS) before deploying. Then: provision, set production env vars, run `npm run db:migrate` as the release step, run `npm run seed` once, schedule the nightly `npm run backup` with off-site copy, enable managed point-in-time recovery. Verify on the live URL: login works, `/api/health` is 200, the HTTPS-only header is present.
- [ ] **Step 6:** Commit: `git add src docs next.config.ts tests && git commit -m "chore: env validation, health check, security headers, runbook"`

---

### Task 23: Full-flow verification, printer checklist and pilot

**Files:**
- Create: `tests/e2e/full-flow.spec.ts`, `docs/ops/printer-test-checklist.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the end-to-end test:** owner logs in and creates a product; cashier logs in and charges one cash bill and one UPI bill with a flat discount; Print is clicked (hook receives HTML); owner cancels one bill with a reason; the cashier sees the cancelled bill in today's history and Reprint produces a "CANCELLED" and "REPRINT" receipt; owner's report and CSV totals equal the non-cancelled bills; token numbers on the two bills are 1 and 2.
- [ ] **Step 2:** Run `npx playwright test`. Expected: the full e2e suite passes. Run `npm run typecheck`, `npm run lint`, `npx vitest run`. Expected: all green.
- [ ] **Step 3:** Write `docs/ops/printer-test-checklist.md`: record the printer model and connection; set the Windows driver paper size for 58mm and 80mm with zero margins; run Test Print and a real reprint on each width; check the token is readable at a glance, no clipped edges, no browser header/footer, cut position; confirm the optional `--kiosk-printing` shortcut if the owner wants immediate printing.
- [ ] **Step 4:** Run the checklist on the real printer and fix any layout issues found in `render-html.ts` (adjust CSS only; keep the unit tests from Task 11 passing).
- [ ] **Step 5: Go-live gates (all must be true):** accountant has confirmed the GST mode, rate, GSTIN and receipt title in Settings; printer model recorded; `npm run backup:verify` passed in production; owner has changed the seed password; a pilot week at the real counter is completed and its issues are triaged.
- [ ] **Step 6:** Commit: `git add tests docs && git commit -m "test: full-flow e2e and printer checklist"`
