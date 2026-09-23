# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

pnpm workspace (pnpm 9, Node >=20.19). Run from the repository root.

```bash
pnpm install

pnpm app:dev            # Tauri desktop app (starts Vite on :1420, then cargo)
pnpm app:build          # Windows NSIS installer  [needs a Windows host or CI runner]
pnpm web:dev            # Next.js marketing site on :3000
pnpm web:build          # static export to apps/website/out

pnpm typecheck          # tsc --noEmit across all three packages
pnpm format             # prettier

# single package
pnpm --filter @rasko/app  typecheck
pnpm --filter @rasko/app  build:vite     # frontend only, no Rust
pnpm --filter @rasko/website build

# Rust shell
cd apps/app/src-tauri && cargo check     # also validates tauri.conf.json
```

Android (requires ANDROID_HOME + NDK_HOME, neither is set on this machine):

```bash
pnpm app:android:init   # one-time; generates apps/app/src-tauri/gen/android
pnpm app:android:dev
pnpm app:android:build  # signed APK
```

Database:

```bash
supabase start && supabase db reset   # apply all migrations + seed locally
supabase db push                      # apply to a linked hosted project
```

Tests (Vitest + Testing Library, in `apps/app`):

```bash
pnpm --filter @rasko/app test         # run once
pnpm --filter @rasko/app test:watch
pnpm --filter @rasko/app test -- src/auth/__tests__/login.test.tsx   # one file
```

Database policies are verified by hand against `docs/policy-tests.md`.

The PRD §6 scenarios are `src/data/__tests__/scenarios.test.ts`:

```bash
pnpm --filter @rasko/app test -- src/data      # T1-T6, triggers, schema
```

`pnpm --filter @rasko/app icon` regenerates every app icon from `docs/brand/logo.svg`.

## Current state

Scaffolding, design system and app shell are done:

- `packages/ui` — brand tokens, bundled fonts, and 13 components (Button, Input, Select,
  Field, Table, Card, Modal, Drawer, StatusChip, EmptyState, PageHeader, Toast, Tabs) plus
  `formatKes` / `formatDate` / `formatPhone` for the PRD §7 display conventions.
- `apps/app` — permission-aware shell (desktop sidebar, mobile bottom nav, top bar with a
  sync-status slot and user menu) and a stub screen per module, rendering sample data.
- `docs/architecture.md` — schema, RLS matrix, sync design, invoice numbering.

**No business logic exists yet.** Screens read `src/seed/` (invented sample data, delete it
when modules read local SQLite) and their actions raise a toast saying the module is not
built. Modules are built one per session against `docs/prd.md` and checked off in
`docs/PROGRESS.md` (not yet created).

- `supabase/migrations` — 14 versioned migrations implementing the whole schema:
  25 tables, 61 RLS policies, check constraints, indexes, `updated_at` triggers,
  append-only guards, gap-free document numbering and the audit triggers.
- `supabase/seed.sql` — invented Kenyan demo data for local and staging.
- `docs/policy-tests.md` — every policy with a manual dashboard check.

- `apps/app/src/auth` — FR-1.1 to FR-1.6: PKCE sign-in, offline identity cache,
  route guards, owner-only user management. 34 tests.
- `supabase/functions` — `invite-user` and `set-user-active`, which hold the service
  key. See `docs/auth-setup.md` for SMTP and deployment.

- `apps/app/src/data` — the offline-first sync layer (PRD §6). Local SQLite mirror of
  24 tables, outbox, per-table pull cursors, push/pull engine, NFR-S3 scheduler, sync
  status provider, and the repository pattern. T1–T6 pass as integration tests.
- `apps/app/src/features/clients` — FR-3.1 to FR-3.6, the first module on real data.
- `apps/app/src/features/orders` — FR-4.1 to FR-4.7: line editor, status pipeline,
  upcoming deliveries, order-to-invoice, printable order summary.
- `apps/app/src/features/invoices` — FR-5.1 to FR-5.8: issuing and numbering, payments,
  reversals, branded invoice and receipt documents, overdue follow-up.
- `apps/app/src/features/products` — FR-6.1 to FR-6.8: catalogue, movement ledger,
  wastage, low stock, valuation, printable count sheet.

- `apps/website` — the marketing site (PRD §10.3). One static page plus a privacy
  notice, exported to plain files, shipping **no JavaScript at all**. Every business
  fact lives in `content/site.ts`; the photography pipeline is `pnpm --filter
@rasko/website photos`.

`docs/PROGRESS.md` tracks module status and the definition of done.

Next feature module: Suppliers & purchases (PRD §5.7), then Payroll (§5.8) and the
Dashboard (§5.2).

### Things that will bite you

- **The website states no business fact that is not in `content/site.ts`.** An
  unconfirmed fact is `null` there and every component omits a null field rather than
  rendering a placeholder, so a visitor never reads "TBD" and never reads an invented
  number. `scripts/check-content.mjs` runs as part of `pnpm --filter @rasko/website
build` and **fails the build** while the WhatsApp number is missing. That is
  deliberate: the page's only call to action is that link. Run `pnpm --filter
@rasko/website content` for the outstanding list.
- **The website ships zero JavaScript, and should stay that way.** The scroll reveals
  and the header's background are CSS scroll-driven animations (`animation-timeline:
view()` / `scroll()`) inside an `@supports` gate, so a browser without them shows a
  fully readable page. The earlier IntersectionObserver version set `opacity: 0` up
  front, which meant everything below the hero was invisible to anything that did not
  run the script. Adding a `'use client'` component to this app reintroduces that
  class of bug; reach for CSS first.
- **Website photography is generated, not committed by hand.** `content/photos.ts` is
  written by `scripts/build-photos.mjs` from `photos.manifest.json` and the originals
  outside the repo. Edit the manifest, then re-run `pnpm --filter @rasko/website
photos`. Editing `content/photos.ts` directly is overwritten on the next run.
  `next.config.mjs` sets `images: { unoptimized: true }`, so there is no server to
  resize anything: every width the site serves has to exist as a file first.
- **Relative imports in `apps/website` carry no `.js` extension**, unlike
  `packages/ui`. `tsc` resolves the extension but the Next webpack build does not, and
  it fails with "Module not found" pointing at a file that plainly exists.
- **`@rasko/ui` ships TypeScript source, not a build artifact.** Next.js needs it in
  `transpilePackages` (already set). There is no build step to run before consuming it.
- **`.env` lives at the repository root, not in the app.** `apps/app/vite.config.ts` sets
  `envDir` to the root and widens `envPrefix` to `['VITE_', 'SUPABASE_', 'APP_']`, so the
  variables in `.env.example` work under their documented names. Adding a variable that
  does not carry one of those prefixes will silently not reach the bundle.
- **The updater plugin is a dependency but is deliberately not registered** — it refuses to
  initialise without a minisign public key, and no keypair exists yet. `apps/app/src-tauri/src/lib.rs`
  documents the four steps to switch it on at release-signing time.
- **Fonts are vendored in `packages/ui/fonts/`** with their OFL licences. Never replace them
  with `next/font/google` or a CDN link; the app must work fully offline.
- **`docs/brand/logo.svg` is a placeholder** monogram generated from Lora outlines. Replacing
  it means re-running the icon script.
- **`shell/navigation.ts` is a transcription of the PRD §3.1 matrix.** When that table
  changes, change this and nothing else. Hiding a module there is a usability decision, not
  a security one — the server refuses the data regardless (RLS is the boundary).
- **`rsk-desktop-only` / `rsk-mobile-only` use `!important`** and are declared last in
  `components.css`, so they beat any layout utility on the same element. Pairing
  `rsk-desktop-only` with a layout class will not work — it reveals as `block`.
- **Guard triggers enforce only when `auth.uid()` is not null.** A null caller is
  `postgres` or `service_role` — a migration, the SQL editor, a backend job — and is
  trusted. Without that, no admin could deactivate a user or repair data.
- **The document-numbering triggers are `SECURITY DEFINER` on purpose.**
  `app.document_counters` is ungranted to `authenticated` so no client can burn
  numbers; the triggers need definer rights to reach it. Removing that breaks every
  order insert.
- **`AuthGateway` is the only auth surface.** Every Supabase Auth and `profiles` call
  the client can make is declared in `auth/gateway.ts`. Tests inject a fake
  implementation, so add new calls there rather than reaching for the client directly.
- **The offline identity cache is not an authorisation.** `auth/sessionCache.ts` decides
  what this device draws while the server is unreachable (NFR-S6, T5). Every request
  still carries a real JWT and RLS decides what is permitted.
- **Modals are mounted only while open.** A closed `<dialog>` keeps its fields in the
  DOM and the accessibility tree, which produces duplicate labelled controls.
- **`data/sqlite/tables.ts` generates both the local DDL and the value codec.** Adding a
  column there is the whole change. Hand-writing either half separately lets a column
  sync but decode wrong, which surfaces later as a wrong number on a document.
- **A repository never touches the network.** Feature code reads and writes SQLite; the
  sync engine carries writes upward on its own schedule. That is what makes NFR-S1 ("the
  UI never blocks on the network") structurally true instead of a per-screen habit.
- **Local foreign keys are deliberately absent** (`PRAGMA foreign_keys` stays off). A
  device holds a partial replica: an `order_item` can arrive before its `order`, or
  reference a parent the role cannot see. The server enforces integrity; it is the only
  place that sees the whole picture.
- **`created_at` is server-owned on append-only tables** (migration 0015). It is their
  pull cursor, so a device clock must never set it.
- **`node:sqlite` is loaded via `createRequire`** in `nodeDatabase.ts`. Vite strips the
  `node:` prefix and fails to resolve `sqlite`; `server.deps.external` does not help.
  Test-only file — the device uses `tauriDatabase.ts`.
- **`SyncProvider` reports `unavailable` outside Tauri**, so `vite preview` and the tests
  show connectivity only, with "Sync now" disabled, rather than faking a sync state. A
  feature screen must render a state for `db === null` — it cannot assume storage exists.
- **Balance arithmetic exists twice**, in `client_balances` on the server and in
  `clientsRepository.ts` for offline use. `features/clients/__tests__/balances.test.ts`
  pins them together with figures taken from the live Postgres views; regenerate them
  there if the views change on purpose.
- **`statusPipeline.ts` mirrors `app.guard_order_transition`.** Change one and you must
  change the other, or the UI offers a move the server then refuses.
- **Stock deduction is a state, not an event.** `app.sync_order_stock` asserts "an order
  at or past the deduction point has a sale movement per catalogue line", re-evaluated
  from both `orders` and `order_items`. A transition trigger looked right and was wrong:
  an order created and delivered offline arrives as one INSERT, and its lines arrive
  after the order.
- **`products` has no `current_stock` column and must never gain one.** Stock is
  `sum(quantity)` over the ledger; a stored copy is the merge conflict the append-only
  design exists to avoid.
- **A document must close the drawer that opened it.** A native `<dialog>` renders in
  the browser's top layer, above every z-index, so a document overlay opened from
  inside a Drawer is buried by it.
- **Invoice numbers are never generated on the device.** Issuing sets the status and
  leaves `invoice_number` null; the server allocates from its row-locked counter when
  the row arrives. A device that invented one would break FR-5.1 the first time two
  devices were offline together.
- **Printed documents are HTML, not a PDF library.** `OrderSummaryDocument` is an A4
  print view; both WebViews save a print job as PDF. `@media print` hides `.shell`, so
  only the document prints.
- **In tests, both the desktop table and the mobile cards render.** jsdom loads no
  stylesheet, so `rsk-desktop-only` / `rsk-mobile-only` hide nothing. Scope queries to
  one container or a document-wide `getByText` matches twice.

## Source-of-truth rules

- **All requirements live in `docs/prd.md`**, addressed by ID (`FR-x.x`, `NFR-x.x`, `T1`–`T6`).
  Reference the ID in commits and PRs. If a requirement seems wrong, say so — do not silently
  deviate from it.
- **All visual decisions live in `docs/brand.md`.** No color, font, or icon choice is made in
  code.
- `[FILL IN: ...]` markers in the docs are **unanswered client questions** (collected in PRD
  §12). The project owner has approved **recommending and implementing** an answer rather
  than leaving a module inert — provided the choice is reversible from settings rather than
  code, documented with its reasoning, and recorded in `docs/PROGRESS.md` for client
  sign-off. Never invent a value silently, and never bury one in code. The decisions taken
  so far (stock deduction, VAT, pricing, commissions) are listed in `docs/PROGRESS.md`.
- Work is sequenced one module per session and checked off in `docs/PROGRESS.md` (not yet
  created). **`docs/architecture.md` is the schema source of truth** — full column
  definitions, the RLS matrix, the sync design and invoice numbering. Migrations implement
  it; they do not invent alongside it.

## Planned architecture

One React/TypeScript codebase, Tauri 2 shell, Supabase backend:

| Path           | Contents                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| `apps/app`     | Tauri 2 + React — the Windows desktop and Android app (one codebase, both targets) |
| `apps/website` | Next.js marketing site                                                             |
| `packages/ui`  | Shared design system used by both                                                  |

Targets: Windows 10/11 via NSIS installer with `tauri-plugin-updater` (minisign-signed
manifest); Android 8.0+ / minSdk 26 via signed APK with an in-app version check.

### Offline-first data flow (PRD §6 — the contract that shapes everything)

Every device holds a **full local SQLite database**. All reads and writes hit local storage
first; **the UI never blocks on the network**. Local writes enter an outbox queue that pushes to
Supabase; pulls are incremental per table using an `updated_at` cursor. Sync runs on launch,
debounced after each write, every 5 minutes while open, on reconnect, and manually — only while
the app is open (no background service; accepted Tauri mobile constraint).

Consequences to hold onto when writing any feature:

- **Server wins** for shared mutable records. Payments and audit events are append-only, so they
  never conflict — this is why FR-5.5 forbids editing or deleting a payment (corrections are
  reversal entries) and why T3 (same invoice paid offline on two devices) must not lose money.
- **Deletes are soft** (`deleted_at`) so they sync safely. FR-3.5 additionally blocks deleting a
  client with unpaid invoices.
- **Derived values are never stored as editable fields.** Invoice balance is computed from
  payments (FR-5.4); current stock is computed from `stock_movements` (FR-6.2). Writing a
  balance or stock column directly is a bug, not a shortcut.
- Session and role are cached locally so the app opens offline (FR-1.2, NFR-S6) — but see
  security below.

### Security model

Supabase **Row Level Security is the enforcement layer, always**. The UI hides what a role
cannot use, but hiding is never the security mechanism (PRD §3.1) — every table needs RLS, and a
cached offline role grants nothing server-side. Roles: `owner`, `manager`, `accountant`, `sales`;
the permission matrix in PRD §3.1 is the specification.

Every sensitive action (payment, payroll approval, delete, price change, role change, stock
adjustment) writes to `audit_log` with user, timestamp, and before/after values.

The app ships with the **anon key only**; the service key lives exclusively in GitHub Actions
secrets. The `anon` role reaches nothing but the insert-only, captcha-protected website
contact-form table.

### Data conventions (PRD §8, §7)

- UUID primary keys; `created_at` / `updated_at` / `deleted_at` on every table; `timestamptz`
  timestamps; status fields as check-constrained text.
- **Money is `bigint` integer cents** everywhere internally, displayed as `KES 12,500.00`.
- Dates `DD/MM/YYYY`, timezone `Africa/Nairobi`, phone numbers stored `+254...`. English UI.
- Invoice numbers `INV-YYYY-NNNN`: sequential, gap-free, never reused (FR-5.1) — this needs a
  server-side sequence that survives offline creation.
- Statutory payroll rates (PAYE, NSSF, SHIF, Housing Levy) are **configurable with effective
  dates**, never hardcoded (FR-9.3) — Kenyan rates change.
- Schema lives in versioned Supabase migrations; updates must never destroy unsynced local data.

## Design constraints (binding, from `docs/brand.md` + PRD §7)

Palette is locked to green / white / black. Rasko Green `#2D6A2F` (hover `#1F4D22`, active
`#16381A`, tint `#E9F2E7`, tint-border `#CFE3CC`); surfaces `#FFFFFF` / `#F7F7F5`; text `#111111`
/ `#5C5F58`; border `#E4E4E0`; disabled `#A3A69B`. Semantic: success `#2D6A2F`, warning `#B45309`,
danger `#B3261E`.

- **There is no accent color** — actions and active states use Rasko Green. Do not introduce new
  hues.
- **No emojis anywhere in the UI.** No exclamation marks in UI copy. No gradients, no
  purple/blue palettes, no glassmorphism. Black is for text and icons only, never large fills.
- **No dark mode in v1.**
- Fonts: Lora (headings/document titles), Manrope (body/UI), both SIL OFL and **bundled in the
  app, never CDN-loaded** — the app must work fully offline. The website self-hosts the same
  files. Money and quantity columns use `font-variant-numeric: tabular-nums`. Type scale
  12/13/14/16/20/24/32.
- One icon library (Lucide), consistent stroke weight.
- Businesslike density: tables on desktop, cards on mobile; typography-led hierarchy. Empty
  states instruct and link to the next action.
- Documents (invoice, receipt, payslip, order summary) are A4, print-friendly, ink on white,
  with Rasko Green used only for the header rule, section headings, and totals row.
- The logo is a **placeholder** (`docs/brand/logo.svg` — an "RSS" monogram in Lora
  SemiBold, outlined). When final art arrives only that file changes, plus regenerated icons.
- Voice: plain, professional Kenyan English; no marketing fluff inside the app.
- **The client is a eucalyptus cut-foliage grower, not a florist** (PRD §12 q1, answered
  2026-09-12). `docs/brand.md` used to say the website should show "photography of real
  flowers"; there are no flowers in anything the client supplied. Do not stage, buy in or
  generate imagery of bouquets or event work.
- Website-only: a fluid display type scale above the app's 32px cap, 16px body, and one
  hard rule — **type is never set on top of a photograph**, because the usual fix for
  that is a scrim, and a scrim is a gradient. See the Website section of `docs/brand.md`.

## Out of scope for v1

eTIMS integration, M-Pesa Daraja auto-reconciliation (payments are recorded manually), SMS
notifications, iOS, multi-branch, e-commerce, loyalty programs. Keep the KRA PIN field on
invoices so eTIMS stays additive later.
