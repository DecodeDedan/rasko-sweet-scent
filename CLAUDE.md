# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `supabase/demo/demo-data.sql` — invented demo data for the policy checks only. It is
  **not** loaded by `db reset` (the local database starts empty and real). Reference rows
  (company settings, tax, statutory rates) come from migration `20260924000200`.
- **Super admin** — an owner with `profiles.is_super_admin` (migration `20260924000100`),
  created once per project with `pnpm admin:create`. Protected from other owners; only it
  grants the owner role. `auth/userAdmin.ts` mirrors the trigger for the Users screen.
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

- `apps/app/src/features/suppliers` — FR-7.1 to FR-7.6: suppliers, purchases,
  receipt into stock, supplier payments, payables aging.
- `apps/app/src/features/payroll` — FR-8.1 to FR-8.8: employees, allowances,
  advances, monthly runs with snapshotted statutory rates, payslips.
- `apps/app/src/features/dashboard` — FR-2.1 to FR-2.8: daily summary, 30-day
  trend, rankings, aging, alerts, CSV export, role scoping.
- `apps/app/src/features/settings` — FR-9.1 to FR-9.6: company profile, tax,
  statutory rates, system status, audit log viewer.

- `apps/website` — the marketing site (PRD §10.3). One static page plus a privacy
  notice, exported to plain files. Animated with GSAP + ScrollTrigger (scroll),
  Framer Motion (load and interaction) and three.js (the turning stem in the
  specimen section). Every business fact lives in `content/site.ts`; the
  photography pipeline is `pnpm --filter @rasko/website photos`.

`docs/PROGRESS.md` tracks module status and the definition of done.

**Every PRD §5 module is now built.** What remains before go-live is not feature
work: the Windows installer and Android APK have never been built, the updater is
not registered, nightly backups do not exist, and the website still lacks the
WhatsApp number its build guard requires. See `docs/PROGRESS.md`.

### Things that will bite you

- **`site.url` gates every absolute URL** (canonical, sitemap entries, share image, JSON-LD
  `url`/`logo`). While it is null those are omitted rather than resolved against localhost.
  JSON-LD is built from `content/site.ts` only and must never state more than the page does.
- **The Google map loads with the page** (`components/FarmMap.tsx`), at the owner's request
  (2026-09-24). The privacy notice says so and says what Google receives. Change one and you
  must change `app/privacy/page.tsx` too.
- **The website states no business fact that is not in `content/site.ts`.** An
  unconfirmed fact is `null` there and every component omits a null field rather than
  rendering a placeholder, so a visitor never reads "TBD" and never reads an invented
  number. `scripts/check-content.mjs` runs as part of `pnpm --filter @rasko/website
build` and **fails the build** while the WhatsApp number is missing. That is
  deliberate: the page's only call to action is that link. Run `pnpm --filter
@rasko/website content` for the outstanding list.
- **`app/site.css` must never contain a hidden start state.** No `opacity: 0`, no
  `scaleX(0)`, no `visibility: hidden` waiting on a class. Every from-state is written
  at runtime by `gsap.from()` or a Framer Motion `initial`, which is what keeps the
  page fully readable when the bundle never arrives. This rule has already been broken
  once here: an IntersectionObserver version set `opacity: 0` in CSS and left
  everything below the hero invisible to anything that did not run the script. There is
  a standing check for it — strip every inline style in the console and confirm nothing
  computes to `opacity: 0`.
- **Never give the hero photograph an entrance animation.** It is the page's LCP
  element. Wrapping it in a Framer Motion `initial={{ opacity: 0 }}` makes it wait for
  hydration: measured at **1,205ms** of render delay, against **70ms** once the
  animation was removed. It still moves — GSAP drifts it on scroll, which costs nothing
  at load because it only starts after the element has painted.
- **Three libraries, one job each, no overlap.** GSAP + ScrollTrigger owns everything
  scroll-linked (`components/motion/ScrollMotion.tsx`, which renders null and drives the
  markup by class name). Framer Motion owns the hero load sequence and the header
  (`components/Hero.tsx`, `components/SiteHeader.tsx`). three.js owns the stem study
  (`components/StemCanvas.tsx`). Two libraries animating the same property fight each
  other and the winner changes with load order.
- **They cost 185 kB gzipped.** three.js is loaded with `next/dynamic` after first
  paint (`components/StemStudy.tsx`), so First Load JS is 194 kB, not the 333 kB it is
  with three in the main bundle. The buyers are Kenyan trade customers on phones; keep
  it lazy, and keep the placeholder the same size as the canvas or the GSAP pin
  measures the wrong height.
- **The variety study walks all four varieties.** On desktop one ScrollTrigger in
  `StemStudy.tsx` pins the section and hands the four panels off, writing progress
  into a ref that `StemCanvas.tsx` reads each frame; the stem reshapes between the
  varieties' leaf parameters (`LEAF_FORMS`, same order as `content/site.ts`) in the
  same scroll window as the text. Below 56rem there is no pin: the stem is CSS-sticky,
  full screen and softened (opacity) _behind_ the list, which scrolls over it (owner,
  2026-09-25; it is a drawn stem, not a photograph), and the meter sticks to the foot
  of the screen, filled from the same progress. three.js never listens to scroll itself.
- **Every variety is sold as standard or spray** (owner, 2026-09-26). Website:
  `forms` on each variety in `content/site.ts`. App: a variety is a `categories`
  row (the four are seeded by migration `20260926000100`) and the form is
  `products.stem_form`, so "Baby Blue spray" and "Baby Blue standard" are separate
  products with their own price and stock.
- **Adding a column to `tables.ts` really is the whole change.** `migrateLocalSchema`
  widens old device tables with `ALTER TABLE ADD COLUMN` and clears that table's
  pull cursor so existing rows re-pull and fill in.
- **Licensed reference photography lives in `apps/website/reference/`, apart from the
  farm's own originals.** A manifest entry carrying a `credit` object is resolved from
  that directory instead; the credit then flows into `content/photos.ts` and the
  component **must** render it, because that is the licence condition and it is also
  what stops stock imagery being mistaken for Rasko's crop.
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
- **The updater is registered** against the minisign key in `tauri.conf.json` (private key in
  `~/.tauri/rasko.key`, never committed) and polls
  `github.com/DecodeDedan/rasko-sweet-scent` releases. The repo must stay public for
  installed copies to download updates without credentials.
- **Invitation and reset emails link with `token_hash`, not `?code=`.** The app uses PKCE,
  and a PKCE code can only be redeemed by the app. The website's `/reset-password` page
  verifies the hash (`supabase/templates/`, docs/auth-setup.md §2).
- **Fonts are vendored in `packages/ui/fonts/`** with their OFL licences. Never replace them
  with `next/font/google` or a CDN link; the app must work fully offline.
- **`docs/brand/logo.svg` is the stacked RSS monogram** (the client's recreation, supplied
  2026-09-24), taller than wide, in its own green `#134B21`. `tauri icon` needs a square, so the
  icon script first generates `logo-square.svg` from the logo's viewBox; never edit that file
  by hand. The website reads `logo.svg` directly: `<img>` in the header and footer (the footer
  reverses it to white with a CSS filter) and inline SVG in the hero via `BrandMark.tsx`, which
  reads the file at build time. There is no copy to drift.
- **The hero monogram draws itself with GSAP DrawSVG** and the slogan scramble-reveals on a
  loop (SplitText + ScrambleText, `ScrollMotion.tsx`); each word is locked to its finished width
  so the line never rewraps while it flickers. The line path carries no stroke in the markup; GSAP adds it for the
  animation only, so without script the mark is simply filled.
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

- **Statutory deductions come off gross before PAYE.** NSSF, SHIF and the Housing
  Levy are allowable deductions under the Tax Laws (Amendment) Act 2024, so
  `computePayroll` subtracts them and _then_ applies the bands. Computing PAYE on
  gross overstates tax for every employee. Which ones precede PAYE is configurable
  (`deductions_before_tax` on the PAYE config), so an amendment is a settings change.
- **A payroll run snapshots its rates and its employees.** Reprinting an old
  payslip must reproduce the original figures, so nothing is recomputed on read.
  `app.guard_payroll_approval` freezes the snapshot once approved.
- **`days_worked` is a `qty` column** — stored as thousandths like every other
  quantity. A raw SELECT bypasses the codec, so divide by 1000 by hand there.
  This bit once already.
- **Purchases never write stock movements from the device.** The server trigger
  `app.receive_purchase_into_stock` owns them, idempotently.
- **The dashboard stores nothing.** Every figure is an aggregate computed on read;
  a cached total is a second source of truth that drifts on the next sync.
- **Client email is a synced row, not a network call.** `features/email` inserts
  `outbound_emails`; the server sends it (`send-email`, `pg_net`, `pg_cron`
  sweep) and the status syncs back. The table pushes with `pushInsertOnly` so a
  retried push can never reset `sent` to `queued` and send twice. The preview in
  Settings imports the same `compose.js` the function runs. Setup:
  `docs/email-setup.md`.
- **Supabase Auth does not send mail here.** The Send Email Hook hands every auth
  email to `send-auth-email`, which uses the same failover transport as client
  email (`_shared/email/transport.js`: Brevo, Resend, Gmail; health shared in
  `email_provider_health`). Local mail goes to Mailpit only when no provider has
  credentials. `supabase/templates/` is the fallback for a disabled hook.
- **Every email, Auth included, comes from `_shared/email/layout.js`.** Edit the
  frame there, then run `pnpm emails:auth`; never hand-edit `supabase/templates/`.
- **The software is "RSS Management System".** `productName`, `mainBinaryName` (the
  installed executable), the window title and `index.html` all say so. The Rust crate is
  `rss-management-system` (lib `rss_management_system_lib`) because a crate name cannot
  contain spaces, which is also why `tauri dev` on macOS shows that lowercase name in the
  menu bar: an unbundled dev binary has no app bundle to carry the display name.
- **App icons come from `pnpm --filter @rasko/app icon`**: the monogram reversed to white
  on a deep-green rounded tile (`scripts/logo-square.mjs`, then `tauri icon`).
- **Salaries can be paid by M-Pesa B2C** (`payroll_payouts`, migration `20260927000100`).
  The device names only the payslip line; `app.prepare_payroll_payout` sets the amount
  (net pay rounded down to whole shillings) and the phone. One live payout per line;
  `unknown` means money may have moved and is never retried automatically. The app's
  preview imports the server's own rules from `_shared/mpesa/b2c.js`. Setup:
  `docs/mpesa-setup.md`.
- **Salaries can also go through IntaSend, to M-Pesa or a bank** (migration
  `20260929000100`, `_shared/payouts/`). `PAYOUT_PROVIDER` picks the sender;
  `mpesa-b2c` is the dispatcher for both despite its name. IntaSend's callback
  is only a hint: a payout is settled from IntaSend's status endpoint, and only
  when the answer's `batch_reference` is our payout id. `requires_approval` is
  `NO`, so an IntaSend send that times out is `unknown`, never retried. The
  payout rules live in `_shared/payouts/rules.js` and are mirrored in
  `app.prepare_payroll_payout`. Setup: `docs/intasend-setup.md`.
- **The Pay salaries dialog polls while payouts are in flight** (`syncNow` every
  15 s, only while open) and reads the IntaSend balance through `payout-wallet`
  via `AuthGateway.payoutWallet()`. The balance is advisory: it blocks sending
  only when known and short, never when unreachable (NFR-S1).
- **Every account signs in with a company address** (`name@raskosweetscent.com`), and
  there are no mailboxes: `_shared/mailbox/routing.js` creates a Cloudflare Email
  Routing rule forwarding it to the person's own inbox. The invitation therefore goes
  to that personal inbox, never to the new address, because Cloudflare delivers
  nothing until the inbox clicks its verification link. `invite-user` creates the
  profile last (profiles.id is ON DELETE RESTRICT), and deactivation pauses the rule.
  The Users screen imports the same address rules. Setup: `docs/company-email.md`.
- **The first-run tour anchors on `data-tour`** attributes (sidebar and bottom
  nav items, `sync`, `help`). Renaming one without updating `onboarding/tour.ts`
  silently turns that stop into a centred dialog.
- **The website build fails on purpose while the WhatsApp number is missing.**
  That is `scripts/check-content.mjs`, not a broken build.

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
- The logo is `docs/brand/logo.svg`, the stacked "RSS" monogram in its own green `#134B21`.
  That is an artwork colour, not a UI token: it never enters the palette. The slogan is
  "All that nature gives." (`content/site.ts`).
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
