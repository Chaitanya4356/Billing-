# Billing & Token Management System: Requirements and Design (v1)

Status: **Draft for review.** No code exists yet. Date: 2026-11-10.

## 1. Purpose and success criteria

A fast, web-based counter billing tool for one tea shop / small restaurant. The cashier picks items, takes cash or UPI, and gets a unique bill number and a daily token number, then prints a combined thermal receipt.

Success means:
- A typical sale (2-3 items, cash) takes under 10 seconds with no mandatory customer details.
- Bill numbers are unique and gap-free. Tokens are unique per business day.
- Historical bills never change when products, prices or shop details change later.
- Cancelled bills stay in history. Reprints never create a new bill or token.
- The owner can see today's and past sales, split by cash and UPI, from any device with internet.

## 2. Scope

### In scope (v1)
1. Billing with bill numbers and tokens
2. Products and categories (enable/disable, soft delete)
3. Cash and UPI payment recording
4. Bill-level flat and percentage discounts, with an owner-configured cashier limit
5. GST and shop settings
6. Manual printing (58mm and 80mm), receipt preview and test print in Settings
7. Bill history: search, view, cancel, reprint
8. Dashboard: today's sales, bill count, payment breakdown, recent bills
9. Daily, weekly and monthly reports with cash/UPI breakdown and CSV export
10. Owner and Cashier roles; owner can create cashiers, reset passwords and deactivate users
11. Audit log of important actions
12. Automatic daily backups

### Out of scope (v1)
Inventory, kitchen orders, delivery, customer management, advanced staff management, payment gateway, offline mode, automatic or silent printing, item variants and notes, split payments, held/pay-later orders, multi-shop UI, multiple languages.

## 3. Decisions

### Confirmed
| Topic | Decision |
|---|---|
| Hosting | Cloud-hosted, **online-only**. Billing is unavailable if the internet is down. |
| Shops | Single shop. Schema keeps `shop_id` on every table so multi-shop is possible later. |
| Client OS | Windows counter PC, modern Chrome or Edge. |
| Printing | **Manual only.** Print button after a sale, Reprint in bill history. No auto-print. |
| Customer data | Optional name and phone on the bill only. No address, no customer table. |
| Receipt | One combined receipt (bill details plus token). English only. |
| Payment | Cash or UPI, one method per bill. UPI is confirmed manually by the cashier. |
| Prepaid only | A bill is created only when payment is recorded. No unpaid or held bills. |
| Currency, time | INR, timezone `Asia/Kolkata`. |

### Open items (do not block the design; defaults apply until answered)
| Item | Default until answered |
|---|---|
| Printer model, USB/LAN, paper width | Browser printing with 58mm and 80mm layouts selectable in Settings. Needed for the pilot test. |
| GST: registered or composition, rate, inclusive/exclusive, GSTIN, receipt title | GST off. When on: one shop-wide rate, prices inclusive, title "Tax Invoice". Accountant to confirm before go-live. |
| Print dialog | Each Print click opens the browser print dialog. The optional `--kiosk-printing` Windows shortcut can make Print immediate without code changes. |
| Bill number format | Prefix + financial year + 6 digits, reset each financial year (e.g. `B-2627-000123`). |
| Token reset | Daily at 00:00 IST, configurable day-start hour, optional "never reset" mode. |
| Cancellation | Owner only, mandatory reason. A setting lets cashiers cancel same-day bills. |
| Rounding | None. Optional round to nearest rupee, stored as `round_off`. |

## 4. Roles and permissions

| Capability | Owner | Cashier |
|---|---|---|
| Billing screen, charge, print | Yes | Yes |
| View bills | All dates | Today's business day only |
| Reprint | Yes | Yes (audited) |
| Cancel bill | Yes | Only if owner enables the setting, same business day |
| Apply discount | Unlimited | Within owner-configured limit |
| Products and categories | Yes | No |
| Dashboard, reports, CSV export | Yes | No |
| Settings, users, audit log | Yes | No |

User management is limited to: create cashier, reset password, deactivate/reactivate. Deactivated users cannot log in; their bills and audit entries remain.

## 5. Architecture

A modular monolith. One Next.js (App Router) application with PostgreSQL.

- **UI:** React, TypeScript (strict), Tailwind CSS. Tablet-landscape and desktop first, usable on a phone for owner views.
- **Mutations:** Server Actions as thin wrappers. They validate with Zod, check the session and role, then call a service.
- **Business logic:** plain TypeScript services under `src/modules/<module>/` with no Next.js imports.
- **Data access:** Drizzle ORM (Prisma is an acceptable alternative; choose one at setup). Each module's repository is the only code that touches its tables. Counters and reports use explicit SQL.
- **Auth:** server-side sessions in httpOnly, Secure, SameSite cookies. Passwords hashed with argon2 or bcrypt.
- **Cart:** held in browser state only. Nothing is stored until the cashier charges.
- **Modules:** `auth`, `users`, `shop` (shop and settings), `catalog` (categories, products), `billing`, `bills`, `payments`, `reports`, `printing` (receipt model and renderers), `audit`, `backup` (documentation and scripts).

### Hosting and operations
- Next.js on a managed platform or a VPS, with managed PostgreSQL in an Indian region for counter latency.
- HTTPS only. Secrets in environment variables.
- **Backups:** provider automated backups with point-in-time recovery, plus a nightly logical dump to separate storage with 30 days retention. A restore is tested before go-live and at least quarterly.
- **Internet outage mitigation (documented for the shop):** keep a phone hotspot as a backup connection and a paper bill book as a last resort. Paper bills are not entered into the system retroactively in v1.

## 6. Data model

All money is stored as **integer paise**. All timestamps are `timestamptz` (UTC). `business_date` is derived in `Asia/Kolkata`, honouring the day-start hour.

| Table | Key columns |
|---|---|
| `shops` | id, name, address, phone, gstin (nullable), timezone, created_at |
| `shop_settings` | shop_id (PK), receipt_header, receipt_footer, paper_width (58/80), bill_prefix, token_reset_mode (daily/never), day_start_hour, gst_enabled, gst_rate_bp, gst_inclusive, receipt_title, round_to_rupee, cashier_discount_max_pct_bp, cashier_discount_max_flat_paise, cashier_can_cancel |
| `users` | id, shop_id, name, username (unique per shop), password_hash, role (OWNER/CASHIER), is_active, created_at |
| `categories` | id, shop_id, name, sort_order, is_active |
| `products` | id, shop_id, category_id, name, price_paise, short_code, sort_order, is_active, deleted_at |
| `bills` | id (uuid), shop_id, financial_year (e.g. `2026-27`), bill_number (int, restarts each financial year), bill_number_display, token_number, business_date, status (COMPLETED/CANCELLED), subtotal_paise, discount_type, discount_value, discount_paise, taxable_paise, cgst_paise, sgst_paise, tax_paise, round_off_paise, total_paise, customer_name, customer_phone, created_by, created_at, cancelled_by, cancelled_at, cancel_reason, print_count, last_printed_at, idempotency_key, shop_snapshot (jsonb), gst_snapshot (jsonb) |
| `bill_items` | id, bill_id, product_id (nullable, no cascade), product_name, category_name, unit_price_paise, quantity, line_total_paise, sort_order |
| `payments` | id, bill_id, method (CASH/UPI), amount_paise, cash_tendered_paise, change_paise, upi_reference, status (RECORDED/VOIDED), created_at |
| `number_sequences` | shop_id, key (e.g. `bill:2026-27`, `token:2026-11-10`), last_value; PK (shop_id, key) |
| `audit_logs` | id, shop_id, user_id, action, entity_type, entity_id, meta (jsonb), created_at |

### Constraints and indexes
- `UNIQUE(shop_id, financial_year, bill_number)`, `UNIQUE(shop_id, business_date, token_number)`, `UNIQUE(shop_id, idempotency_key)`, `UNIQUE(shop_id, username)`.
- CHECKs: `quantity > 0`, `unit_price_paise >= 0`, `total_paise >= 0`, and `total = subtotal - discount + tax + round_off` (exclusive GST) or the equivalent for inclusive GST as defined in section 8.
- Indexes: `bills(shop_id, business_date)`, `bills(shop_id, created_at DESC)`, `bills(shop_id, bill_number)`, `bill_items(bill_id)`, `payments(bill_id)`, `products(shop_id, category_id, is_active)`, `audit_logs(shop_id, created_at DESC)`.

### History preservation
`bill_items` copies the product and category name and unit price at sale time. `bills.shop_snapshot` copies shop name, address, phone and GSTIN, and `gst_snapshot` copies the GST mode, rate and receipt title. A reprint reads only stored bill data.

## 7. Billing and numbering workflow

### Client
1. Cashier opens Billing, picks a category or searches, taps products to add them.
2. Adjusts quantity with -/+ or removes lines. Optionally enters a discount and optional customer name/phone.
3. Chooses Cash or UPI. For cash, enters the amount tendered (quick buttons for exact and common notes). For UPI, confirms "Payment received" and optionally enters a reference.
4. Taps Charge. A UUID idempotency key, generated when the cart was started, is sent with the request.

### Server: `createBill`
1. Authenticate; take `shopId` and user from the session.
2. Validate input with Zod. The client sends product IDs, quantities, discount, payment details, customer details and the idempotency key. **It never sends prices or totals.**
3. Load current products; reject inactive, deleted or foreign-shop products. If a price differs from what the cart displayed, return a "prices changed, please review" error.
4. Enforce discount limits for the cashier role. Compute all amounts with the single shared money function (section 8).
5. Validate payment: cash tendered at least the total; UPI confirmation flag present.
6. In **one database transaction**: return the existing bill if the idempotency key is already used; compute `business_date`; atomically increment the bill counter, then the token counter (always in that order); insert bill, items, payment and an audit row; commit.
7. Return the bill. The client shows the success screen with the large token number and a Print button.

### Numbering rules
- Counters are single-statement atomic upserts on `number_sequences`, executed inside the bill transaction. A rollback also rolls back the counters, so there are no gaps.
- Bill numbers are never reused, including after cancellation. Tokens are never reused within a business day.
- Two counters in the same shop share one sequence.

### Cancel and reprint
- **Cancel:** sets status CANCELLED with mandatory reason, user and time; payments become VOIDED; an audit row is written. Nothing is deleted. Cancelled bills appear in history, are labelled CANCELLED on any reprint, and are excluded from sales totals but shown in their own report line.
- **Reprint:** reads the stored bill, increments `print_count`, updates `last_printed_at` and writes an audit row. It never touches counters.
- **Edit:** bills cannot be edited. To change an order, cancel and re-bill.
- Print happens after commit. A print failure never affects the saved bill.

## 8. Payments, discounts and GST calculation

All calculations use integers (paise and basis points) in one function with exhaustive unit tests.

1. `subtotal = sum(unit_price * quantity)`.
2. **Discount:** flat (paise) or percentage (basis points, `discount = round(subtotal * pct / 10000)`). It cannot exceed the subtotal. A cashier over the limit is rejected with a message that the owner must apply it.
3. `net = subtotal - discount`.
4. **GST off:** `tax = 0`, `total = net`.
5. **GST on, exclusive:** `tax = round(net * rate_bp / 10000)`, `total = net + tax`.
6. **GST on, inclusive:** `tax = net - round(net * 10000 / (10000 + rate_bp))`, `total = net`.
7. CGST and SGST are each half of `tax`: `cgst = floor(tax / 2)`, `sgst = tax - cgst`.
8. Optional rounding: `round_off` brings `total` to the nearest rupee.
9. A total of zero or less is rejected.

Payments: one `payments` row per bill. Cash stores tendered and change. UPI stores an optional reference. UPI is not verified automatically, so the audit log and reports are the control.

## 9. Printing

- **Receipt model:** one function builds a `ReceiptData` object from a stored bill. Renderers consume it. v1 has an HTML renderer for 58mm and 80mm. The business logic does not know about printers.
- **Layout:** `@page` size 58mm or 80mm with zero margin; printable width about 48mm or 72mm; monospace font; high contrast; no background colours. The token number is printed large near the top. Contents: shop name, address, phone, GSTIN (if set), bill number, date/time, token, items with quantity and price, subtotal, discount, GST lines (CGST/SGST), total, payment method, footer. Reprints are marked as a duplicate or reprint copy. Cancelled bills are marked CANCELLED.
- **Print flow:** a hidden iframe renders the receipt and calls print. The Windows default printer must have the correct paper size configured.
- **Settings:** paper width, receipt header and footer text, receipt preview, and a test print that uses sample data and creates no bill.
- **Future:** silent printing through a local agent or printer cloud protocol is a separate later project.

## 10. UI and navigation

- Left rail navigation: Billing, Bills, Products, Reports, Dashboard, Settings. Cashiers see only Billing and Bills. Cashiers land on Billing; owners land on Dashboard.
- **Billing:** left side has a search box, category chips and a grid of large product tiles with name and price. Right side is the cart with -/+ and remove, subtotal, discount, GST, a large payable amount, Cash/UPI toggle, optional customer fields behind a small link, and a large Charge button.
- **After charge:** full-screen confirmation with the token number in large type, bill number, total, a Print button and a New Bill button. Focus returns to search for the next order.
- **Shortcuts:** `/` focuses search, Enter adds the top result, Ctrl+Enter charges, Esc clears the cart (with confirmation).
- **Bills:** searchable table (bill number, token, date, payment method, status, amount) with a detail drawer showing items, payment, Reprint and Cancel.
- **Products:** category list, editable table, enable/disable switch, add/edit slide-over.
- **Dashboard:** today's sales, bill count, cash vs UPI, cancelled count, last 10 bills.
- **Reports:** Day / Week / Month tabs with a date picker, summary cards, cash/UPI split, per-day table, top items, cancelled summary, CSV export.
- **Settings:** tabs for Shop, Receipt, Numbering, GST, Discounts, Users, Audit log.
- Touch targets at least 44px. On narrow screens the cart becomes a bottom drawer.

## 11. Reports and dashboard

- All figures use `business_date` and exclude CANCELLED bills; cancelled bills are reported separately.
- Metrics: gross sales, discounts, GST collected, net total, bill count, average bill, cash total, UPI total, top items by quantity and amount.
- Weeks start on Monday; months follow the calendar month in IST.
- CSV export contains one row per bill (date, bill number, token, status, subtotal, discount, GST, total, payment method) and a summary section.
- Plain SQL aggregates over the indexed `business_date` are sufficient at this scale.

## 12. Security, validation and audit

- Role and `shopId` are enforced in every service call. The tenant identifier comes only from the session.
- Zod validation on all inputs, with limits on string lengths, quantities (1-999) and discount values. The server recomputes all money.
- Login rate limiting and temporary lockout after repeated failures. Session expiry. Minimum password length of 8.
- Origin checks and same-site cookies for CSRF protection.
- Bills, items and payments have no update or delete code path, other than the controlled cancel.
- Audit actions: login failure and lockout, bill created, bill printed/reprinted, bill cancelled, product created/updated/price changed/disabled, settings changed, user created/reset/deactivated.
- Customer name and phone are optional and shown only to authorised users.
- Receipt content is escaped. Least-privilege database role. Secure headers.

## 13. Testing

- Unit tests for the money function: inclusive and exclusive GST, flat and percentage discounts, rounding, CGST/SGST split, edge cases.
- Concurrency test: about 50 parallel `createBill` calls produce unique, gap-free bill numbers and unique tokens.
- Idempotency test: the same key twice returns one bill.
- Permission tests for every role-restricted action.
- Playwright end-to-end tests: charge, print flow, cancel, reprint, report totals.
- Manual print test on the real printer at 58mm and 80mm before the pilot.
- Backup restore drill before go-live.

## 14. Development phases

| Phase | Deliverable | Rough effort |
|---|---|---|
| 0. Setup | Repository, tooling, CI, database, migrations, seed (shop and owner), deployment skeleton | 2-3 days |
| 1. Foundation | Auth, roles, app shell, navigation, settings skeleton | 4-5 days |
| 2. Catalog | Categories and products, enable/disable | 3-4 days |
| 3. Billing core | Money function, counters, `createBill`, idempotency, discounts, GST, payments, billing UI, tests | 8-10 days |
| 4. Receipts and bills | Receipt model, 58/80mm renderers, Print and Reprint, bill history and search, cancel | 5-6 days |
| 5. Insights | Dashboard, reports, CSV export | 4-5 days |
| 6. Admin | User management, audit log viewer, settings completion, test print and preview | 3-4 days |
| 7. Operations | Backups and restore drill, deployment hardening, real-printer test, pilot week and fixes | 5-7 days |

Estimates assume one developer and are rough. Phase 3 comes early because the schema and counter design carry the most risk.

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Internet outage stops billing | Phone hotspot backup, paper bill book, documented procedure. Offline mode is a separate future project. |
| Duplicate or missing numbers | Atomic counters in the bill transaction, unique constraints, idempotency keys. |
| GST errors | Single tested money function, configurable settings, accountant sign-off before go-live. |
| Printer differences | Test on the real printer early; keep print CSS minimal; renderer-agnostic receipt model. |
| UPI cannot be verified automatically | Optional reference, audit log, daily report review by the owner. |
| Cashier forgets to print | Print button is prominent on the success screen; reprint is always available from history. |
| Scope creep | The out-of-scope list in section 2 is the v1 boundary. |
