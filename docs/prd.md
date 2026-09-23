# Product Requirements Document
## Rasko Sweet Scent — Business Management System

Version: 1.0-draft
Date: 1st September 2026
Owner: A.T
Client: Rasko Sweet Scent, Nakuru, Kenya

---

## 1. Overview

Rasko Sweet Scent is a flower business in Kenya. [FILL IN: one paragraph — retail /
wholesale / events / deliveries; what they sell; where they operate.] The business
currently manages clients, orders, invoices, purchases, stock, and payroll using
[FILL IN: notebooks / Excel / M-Pesa statements].

We are building one system: an installable application for Windows desktop and Android
phones that works offline-first, syncs to a central cloud database, enforces role-based
access, and automates invoicing, inventory, and payroll. A marketing website and company
email on the company domain are delivered alongside it.

## 2. Goals and success criteria

Goals:
1. One system replaces notebooks/Excel for daily operations.
2. The owner sees the true financial position of the business at any time, from a phone.
3. Works during internet outages; syncs automatically when online.
4. Staff access only what their role allows.
5. Customer-facing documents (invoices, receipts, payslips) carry the Rasko Sweet Scent brand.

Success metrics (checked 3 months after go-live):
- 100% of orders and payments recorded in the system
- Owner uses the dashboard weekly without assistance
- Every sale produces a branded invoice/receipt
- Payroll computed by the system with zero manual arithmetic
- Month-end stock variance explainable from system records

## 3. Users and roles

Fewer than 10 users. Named accounts only, no shared logins.

| Role | Person | Devices |
|---|---|---|
| owner | [FILL IN] | Phone + desktop |
| manager | [FILL IN] | [FILL IN] |
| accountant | [FILL IN] | Desktop |
| sales | [FILL IN] | Phone |

### 3.1 Permission matrix

| Capability | Owner | Manager | Accountant | Sales |
|---|---|---|---|---|
| Dashboard & full reports | Full | Full | Financial only | Own performance only |
| Clients | All | All | All | Own clients only |
| Orders | All | All | View all | Create, no delete |
| Invoices & payments | All | All | Create/edit | Create invoice, record payment |
| Products & inventory | All | All | View | View |
| Suppliers & purchases | All | All | View | No access |
| Payroll | Full | View only | Prepare only | No access |
| Users & settings | Full | Limited | No access | No access |
| Audit log | Full | View | No access | No access |

Rules:
- Permissions are enforced by Supabase Row Level Security (server side). The UI hides
  what a role cannot use, but hiding is never the security mechanism.
- Every sensitive action (payment, payroll approval, delete, price change, role change,
  stock adjustment) writes to the audit log: user, timestamp, before/after values.

## 4. Scope

In scope (v1): modules 5.1–5.9, marketing website, company email, auto-update, backups,
CSV data import, training.

Out of scope (v1): KRA eTIMS integration [confirm with client's accountant — plan as v2],
M-Pesa Daraja API auto-reconciliation (payments recorded manually in v1), SMS
notifications, iOS, multi-branch, online shop / e-commerce, loyalty programs.

Future (v2 candidates): eTIMS, Daraja reconciliation, WhatsApp order intake, iOS,
multi-branch support.

## 5. Functional requirements

### 5.1 Authentication & user management
- FR-1.1 Email + password login via Supabase Auth (PKCE flow).
- FR-1.2 Session cached locally; app opens offline with cached session; re-auth only
  after explicit logout or prolonged expiry.
- FR-1.3 Roles: owner, manager, accountant, sales. Role stored on the user profile;
  only owner can change roles.
- FR-1.4 Owner-only user management: invite by email, set role, deactivate. Deactivation
  revokes server access immediately and hides the user from pickers without deleting history.
- FR-1.5 Password reset via custom SMTP (not Supabase default emails).
- FR-1.6 Invited users must change password on first login.

### 5.2 Dashboard & reports
- FR-2.1 Daily summary: today's sales value, order count, payments received, total
  outstanding receivables.
- FR-2.2 Sales trend chart, last 30 days.
- FR-2.3 Top 5 clients and top 5 products this month.
- FR-2.4 Receivables aging: 0–30, 31–60, 61–90, 90+ days.
- FR-2.5 Payables summary (what we owe suppliers).
- FR-2.6 Low-stock and wastage alerts.
- FR-2.7 Every report exportable to CSV and PDF.
- FR-2.8 Role scoping per 3.1; sales sees own performance only.

### 5.3 Clients
- FR-3.1 Client record: name, type (individual / corporate / event planner), phone,
  email, KRA PIN (optional, mainly corporate), address, credit terms (days), notes.
- FR-3.2 Search by name or phone; filter by type; sort by name, recent activity,
  outstanding balance.
- FR-3.3 Client detail: contact info, full order/invoice history, lifetime value,
  outstanding balance, recent payments.
- FR-3.4 RLS: sales users see only clients they created; other roles see all.
- FR-3.5 Soft delete blocked while the client has unpaid invoices.
- FR-3.6 Walk-in sales allowed without a client record (flagged "walk-in").

### 5.4 Orders
- FR-4.1 Order: client or walk-in, line items (catalog products and/or custom
  arrangement text), quantity, unit price, discount, total, delivery date/time,
  delivery address, notes, taken-by user.
- FR-4.2 Statuses: draft → confirmed → in production → ready → delivered → closed.
  Cancellation allowed any time before closed and requires manager or owner.
- FR-4.3 Event orders add: event date, venue, setup notes.
- FR-4.4 One-click convert confirmed order → invoice.
- FR-4.5 Sales users create orders, edit only their own drafts, never delete.
- FR-4.6 Order summary PDF, shareable via WhatsApp or printable.
- FR-4.7 Upcoming-deliveries view grouped by date.

### 5.5 Invoices & payments
- FR-5.1 Invoice numbers: INV-YYYY-NNNN, sequential, gap-free, never reused.
- FR-5.2 Invoice PDF, branded: logo, company details, KRA PIN, client details, line
  items, VAT line (if applicable), total, balance due, payment instructions
  (M-Pesa paybill/till [FILL IN], bank details [FILL IN]).
- FR-5.3 Payment methods: M-Pesa, cash, bank transfer, cheque. Each payment records
  method, amount, date, reference (e.g., M-Pesa code), received-by user.
- FR-5.4 Multiple partial payments per invoice; balance always computed from payments,
  never stored as an editable field.
- FR-5.5 Payments are append-only. Corrections happen via reversal entries, never
  by editing or deleting. Reversals restricted to manager/owner.
- FR-5.6 Invoice statuses: draft, unpaid, partially paid, paid, overdue (computed),
  voided.
- FR-5.7 Receipt PDF generated on payment; shareable via WhatsApp.
- FR-5.8 Overdue list with client contact for follow-up.

### 5.6 Products & inventory
- FR-6.1 Product: SKU, name, category (fresh flowers / arrangements & bouquets / vases /
  accessories / other), unit (stem, bundle, piece), cost price, selling price, current
  stock, low-stock threshold.
- FR-6.2 Every stock change writes a stock movement: type (purchase-in, sale, wastage,
  adjustment, return), quantity, reference, user, timestamp, reason (wastage/adjustment).
  Current stock is derived from movements, never directly editable.
- FR-6.3 Pricing per client type if needed (wholesale vs retail). [FILL IN: confirm model]
- FR-6.4 Low-stock view: products at or below threshold.
- FR-6.5 Wastage recording with reason (perishability); wastage report by period/product.
- FR-6.6 Stock deducted at [FILL IN: order confirmation OR delivery — confirm with client].
- FR-6.7 Negative stock allowed but flagged for review (business may sell before recording).
- FR-6.8 Inventory valuation report (qty × cost) and printable stock-count sheet.

### 5.7 Suppliers & purchases
- FR-7.1 Supplier: name, contact person, phone, email, payment terms, KRA PIN, notes.
- FR-7.2 Purchase: supplier, date, line items, quantities, unit costs, total, due date,
  status (ordered → received → paid).
- FR-7.3 Marking received writes purchase-in stock movements. [FILL IN: whether received
  cost updates the product's cost price]
- FR-7.4 Supplier payments recorded against purchases; accounts payable list with aging.
- FR-7.5 Module access: owner, manager, accountant only.
- FR-7.6 Purchases affect stock only after receipt confirmation.

### 5.8 Employees & payroll
- FR-8.1 Employee: name, national ID, KRA PIN, NSSF number, SHIF number, phone,
  position, salary structure (monthly salary or daily rate), payment method
  (M-Pesa/bank) and payment details.
- FR-8.2 Salary components: basic pay plus allowances (housing, transport, other),
  configurable per employee.
- FR-8.3 Salary advances: requested by manager/owner, approved by owner, tracked per
  employee, auto-deducted in the next payroll run.
- FR-8.4 Monthly payroll run: per employee, gross → statutory deductions (PAYE, NSSF,
  SHIF, Housing Levy — rates configurable in Settings with effective dates) → other
  deductions (advances, others) → net pay.
- FR-8.5 Payroll run: prepared by accountant or owner, approved by owner only,
  approval logged.
- FR-8.6 Branded payslip PDF per employee; shareable.
- FR-8.7 Mark salaries paid (bulk or per employee) with method and reference; recorded
  as money movements.
- FR-8.8 Visibility: owner full, manager view-only, accountant sees preparation screens
  [FILL IN: confirm extent]. Sales never see payroll.
- FR-8.9 [FILL IN: commissions for sales staff, if any.]

### 5.9 Settings, audit & sync UI
- FR-9.1 Company profile: name, logo, address, phone, email, KRA PIN, VAT status,
  M-Pesa paybill/till, bank details. Used across all documents.
- FR-9.2 Tax configuration: VAT on/off, rate, applicable categories.
- FR-9.3 Statutory rates (PAYE bands, NSSF, SHIF, Housing Levy) editable by owner,
  with effective dates.
- FR-9.4 Sync indicator on every screen (synced / N pending / offline) + manual "Sync now".
- FR-9.5 Owner system screen: app version, update check, last successful backup date.
- FR-9.6 Audit log viewer (owner/manager) with filters: user, action type, date range.

## 6. Offline & sync requirements

- NFR-S1 Every device keeps a full local SQLite database. All reads/writes hit local
  storage first; the UI never blocks on the network.
- NFR-S2 Local writes enter an outbox queue and push to Supabase; pulls are incremental
  per table using an updated_at cursor.
- NFR-S3 Sync triggers: app launch; debounced after every local write; every 5 minutes
  while open; on connectivity regained; manual.
- NFR-S4 Conflicts: server wins for shared mutable records; payments and audit events
  are append-only so they never conflict.
- NFR-S5 Deletes are soft (deleted_at) so they sync safely.
- NFR-S6 Session and role cached locally for offline launch; server-side RLS remains
  the enforcement layer at all times.
- NFR-S7 Sync happens while the app is open (no background service — accepted Tauri
  mobile constraint; the triggers in NFR-S3 are sufficient at this scale).

Test scenarios (all must pass before go-live):
- T1: Create order offline (airplane mode) → reconnect → appears on owner's device
  and in Supabase.
- T2: Same record edited on two devices offline → deterministic resolution per NFR-S4.
- T3: Payment recorded offline on two devices for the same invoice → both sync,
  balance correct, no lost double-payment.
- T4: Deactivate user while their device is offline → access revoked server-side on
  their next sync.
- T5: Fresh install → login once → kill network → full restart → app fully usable
  with cached data.
- T6: Seed 200 orders + payments locally → sync completes idempotently, no duplicates.

## 7. Non-functional requirements

Performance:
- Cold start under 3 s on a mid-range Android phone and an average Windows PC.
- List screens render from local DB in under 500 ms at 5,000 records.
- A day's work (50 records) syncs in under 10 s on 3G.

Security:
- RLS on every table; anon role reaches only the website contact-form table
  (insert-only, captcha-protected).
- Supabase service key exists only in GitHub Actions secrets — never in the app or
  repository. The app ships with the anon key only.
- Audit log per section 3 rules.

Platform & updates:
- Windows 10/11 via NSIS installer; auto-update via tauri-plugin-updater
  (minisign-signed manifest).
- Android 8.0+ (minSdk 26) via signed APK; in-app version check against the manifest.
- Updates never destroy unsynced local data; schema migrations are versioned.

Localization & conventions:
- Money: integer cents internally (bigint); displayed "KES 12,500.00" with separators.
- Dates DD/MM/YYYY; timezone Africa/Nairobi; phone numbers stored in +254 format.
- English UI.

Design (binding, see docs/brand.md):
- No emojis anywhere in the UI. No decorative gradients, no purple/blue palettes,
  no glassmorphism.
- Colors and typography exclusively from docs/brand.md; one icon library (Lucide),
  consistent stroke weight.
- Businesslike density: tables on desktop, cards on mobile; typography-led hierarchy.
- Empty states instruct and link to the next action.
- Documents (invoice, receipt, payslip) carry the logo and brand colors on a clean,
  print-friendly layout.

Reliability:
- Nightly automated backup (GitHub Actions pg_dump → Cloudflare R2), 30 daily +
  12 monthly retained; restore procedure documented and tested quarterly; failures
  open a GitHub issue; last-backup date visible to owner (FR-9.5).

## 8. Data model (summary)

Tables: profiles (users), clients, orders, order_items, invoices, payments,
reversals, products, categories, stock_movements, suppliers, purchases, purchase_items,
supplier_payments, employees, advances, payroll_runs, payroll_items, company_settings,
tax_config, statutory_rates, audit_log, sync bookkeeping (per-device cursors),
website_contact_messages.

Conventions: UUID primary keys; created_at / updated_at / deleted_at on all tables;
money as bigint cents; timestamptz timestamps; status fields as check-constrained text.
Full column definitions are produced in docs/architecture.md (Prompt 1) and implemented
as versioned Supabase migrations (Prompt 3).

## 9. Compliance & Kenyan specifics
- Data Protection Act 2019: staff and payroll data used for business purposes only;
  privacy policy on the website; [FILL IN: confirm ODPC registration status with client].
- Statutory rates configurable because they change; the system computes but the
  client's accountant verifies the first live payroll.
- eTIMS out of scope for v1; invoice keeps the KRA PIN field so integration is additive.

## 10. Deliverables
1. Windows installer + Android APK (auto-updating)
2. Supabase project (production + staging) with migrations, RLS, seed data
3. Marketing website (Next.js) on the company domain
4. Company email mailboxes on the company domain
5. Documentation: role-based user guides (1–2 pages each, plain language), admin &
   release guide, restore runbook
6. Training: one session per role; short recorded walkthroughs
7. Two-week parallel-run support, then handover under a maintenance agreement
   [FILL IN: monthly fee]

## 11. Acceptance criteria (go-live checklist)
- Test scenarios T1–T6 pass on real devices
- One full payroll dry run matches the accountant's manual computation
- One invoice → payment → receipt cycle end-to-end on desktop and phone
- Owner dashboard reconciles against one manually checked week of business
- Backups ran nightly for 7 consecutive nights; one restore tested into staging
- Both update paths verified (desktop auto-update, Android APK update)
- Each role verified by attempting forbidden actions
- Client signs off UAT with real data

## 12. Open questions (from discovery — answer before the related module)
1. Business model details and product range — ANSWERED 2026-09-12, pending client
   sign-off: eucalyptus cut-foliage grower supplying florists, decorators and
   wholesalers in trade quantities. Established from the client's own photographs
   and confirmed with the project owner. Recorded in docs/PROGRESS.md under
   "Marketing website". Product range within that (varieties, grades, bunch
   specifications) is still [FILL IN].
2. Exact user list per role and their devices [FILL IN]
3. VAT registration status and pricing structure [FILL IN]
4. Stock deduction point: order confirmation vs delivery [FILL IN]
5. Commission structures for sales staff [FILL IN]
6. M-Pesa paybill/till and bank details for documents [FILL IN]
7. eTIMS obligation (ask their accountant) [FILL IN]
8. ODPC registration status [FILL IN]
