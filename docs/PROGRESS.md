# Progress — Rasko Sweet Scent

One module per session, against `docs/prd.md`. A module is done when every
requirement in its section is implemented, tested, and verified against a real
Supabase (not only a mock).

## Definition of done

- [ ] Every `FR-x.x` in the section implemented, or explicitly deferred with a reason
- [ ] Reads and writes go through a repository — local database only, never the network
- [ ] RLS verified for each role that touches the module
- [ ] Tests: the behaviour, the permission boundary, and one offline → sync path
- [ ] `pnpm typecheck`, `pnpm --filter @rasko/app test`, `pnpm format:check` clean
- [ ] Brand rules hold: no emoji, no new hues, tables on desktop and cards on mobile
- [ ] Any `[FILL IN]` the module touches is flagged, never guessed

## Modules

| #   | Module                                         | PRD             | Status                      |
| --- | ---------------------------------------------- | --------------- | --------------------------- |
| —   | Scaffolding, design system, app shell          | §7              | **Done**                    |
| —   | Database: 17 migrations, 61 RLS policies, seed | §8              | **Done**                    |
| 5.1 | Authentication & user management               | FR-1.1 – FR-1.6 | **Done**                    |
| —   | Offline-first sync layer                       | §6, T1–T6       | **Done**                    |
| 5.3 | Clients                                        | FR-3.1 – FR-3.6 | **Done**                    |
| 5.4 | Orders                                         | FR-4.1 – FR-4.7 | **Done**                    |
| 5.5 | Invoices & payments                            | FR-5.1 – FR-5.8 | **Done**                    |
| 5.6 | Products & inventory                           | FR-6.1 – FR-6.8 | **Done**                    |
| 5.7 | Suppliers & purchases                          | FR-7.1 – FR-7.6 | **Done**                    |
| 5.8 | Employees & payroll                            | FR-8.1 – FR-8.9 | **Done**                    |
| 5.2 | Dashboard & reports                            | FR-2.1 – FR-2.8 | **Done**                    |
| 5.9 | Settings, audit & sync UI                      | FR-9.1 – FR-9.6 | **Done**                    |
| —   | Marketing website                              | §10.3           | **Built** — content pending |

## Clients (FR-3.1 – FR-3.6) — done

| Requirement                                         | Where                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| FR-3.1 record fields                                | `ClientForm.tsx`, `clients` table                                           |
| FR-3.2 search, filter, sort                         | `clientsRepository.list()`; phone search normalises `0712…` to `+254712…`   |
| FR-3.3 detail, history, lifetime value, outstanding | `ClientDetailDrawer.tsx`, `clientsRepository.detail()`                      |
| FR-3.4 sales sees only own clients                  | RLS + `scopeClause()`; 5 tests                                              |
| FR-3.5 delete blocked while unpaid                  | `softDelete()` + `clients_guard_soft_delete` trigger                        |
| FR-3.6 walk-in without a client record              | `orders.is_walk_in`; belongs to the Orders module                           |
| Audit on delete                                     | `clients_audit_delete` trigger — server-side, cannot be skipped by a client |

**Known duplication.** Outstanding balance and lifetime value are computed by the
`client_balances` view on the server and again in SQLite, because views are not
mirrored and FR-3.3 must work offline. `__tests__/balances.test.ts` pins the two
together with figures read out of the live Postgres views. If either definition
changes, that test fails. Verified a second way: the same aggregate run against the
running app's synced device database matches Postgres row for row.

## Orders (FR-4.1 – FR-4.7) — done

| Requirement                                          | Where                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| FR-4.1 order + lines, catalogue picker and free text | `OrderForm.tsx`; `order_items.product_id` is nullable for a custom arrangement                     |
| FR-4.2 status pipeline, cancel needs manager/owner   | `statusPipeline.ts` mirrored by `app.guard_order_transition`; cancel by `app.guard_order_cancel`   |
| FR-4.3 event fields                                  | order type `event` reveals venue, date and setup notes                                             |
| FR-4.4 confirmed order → invoice                     | `convertToInvoice()`, creating a **draft** invoice; numbering is server-assigned at issue (FR-5.1) |
| FR-4.5 sales create, edit own drafts, never delete   | `canEdit` / `canDelete` mirrored by the `orders_update_sales` policy                               |
| FR-4.6 order summary, brand-styled, shareable        | `OrderSummaryDocument.tsx` — A4 print document, saved as PDF by the platform                       |
| FR-4.7 upcoming deliveries by date                   | `upcomingDeliveries()`, grouped in Africa/Nairobi                                                  |

**Deferred deliberately.** Stock is not deducted when an order is confirmed or
delivered: FR-6.6 does not say which, and PRD §12.4 is unanswered. The two
transition points (`confirmed_at`, `delivered_at`) and the settings column
(`company_settings.stock_deduction_point`) are in place, so the answer drops in
without reshaping anything. Native share is also deferred — the summary is saved
as a PDF and shared by the platform, which needs no plugin.

## Invoices & payments (FR-5.1 – FR-5.8) — done

| Requirement                               | Where                                                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-5.1 gap-free INV-YYYY-NNNN             | `app.allocate_document_number` (row-locked counter, migration 0001). The device never invents a number: it issues with `invoice_number` null and the server allocates on arrival |
| FR-5.2 branded invoice                    | `InvoiceDocument.tsx`, company details and payment instructions from `company_settings`, client and company snapshots from the invoice                                           |
| FR-5.3 payment fields                     | `PaymentForm.tsx` — method, amount, date, reference, received-by                                                                                                                 |
| FR-5.4 partial payments, computed balance | `invoicesRepository` sums payments less reversals; no balance column exists                                                                                                      |
| FR-5.5 append-only + reversals            | No UPDATE/DELETE policy or grant on `payments`; reversal UI is manager/owner only                                                                                                |
| FR-5.6 statuses                           | `status.ts` mirrors the `invoice_status` view; overdue computed from `due_date` at read time                                                                                     |
| FR-5.7 receipt                            | `ReceiptDocument.tsx`, one per payment, showing the balance remaining                                                                                                            |
| FR-5.8 overdue follow-up                  | Overdue tab with the client's phone and days overdue                                                                                                                             |

**Numbering verified under real concurrency.** Four concurrent Postgres sessions
inserting 25 issued invoices each produced 100 distinct numbers, 1–100, with no
gaps and no duplicates. This closes the gap `docs/policy-tests.md` §13 previously
admitted to.

**VAT is not applied.** `vat_rate_bp` and `vat_cents` are carried and the document
renders a VAT line when they are non-zero, but nothing sets them: PRD §12.3 (VAT
registration and rate) is unanswered. `tax_config` is in place for when it is.

## Products & inventory (FR-6.1 – FR-6.8) — done

| Requirement                           | Where                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| FR-6.1 product CRUD                   | `ProductForm.tsx`; SKU uniqueness checked before insert                                                                 |
| FR-6.2 movement ledger, derived stock | `stock_movements`; `products` has no `current_stock` column and a test asserts it never gains one                       |
| FR-6.3 per-client-type pricing        | **Still open** (PRD §12.2). `product_prices` exists and is empty                                                        |
| FR-6.4 low-stock view                 | Each product against its own threshold, worst first                                                                     |
| FR-6.5 wastage + report               | Reason required by CHECK and by the repository; 90-day report costed at movement cost                                   |
| FR-6.6 deduction point                | **Recommended: delivery.** `company_settings.stock_deduction_point`, applied by `app.sync_order_stock` (migration 0017) |
| FR-6.7 negative stock                 | Allowed, flagged `Negative`, never blocked                                                                              |
| FR-6.8 valuation + count sheet        | Valuation tab; `StockCountSheet.tsx` prints with write-in columns                                                       |

### FR-6.6 — the decision, and why

PRD §12 question 4 was unanswered, and the client had not replied. **Delivery** is
implemented as the default, recorded in a settings column so it is a one-value change:

- Current stock then means what is physically in the shop — the only figure a
  physical count can verify, and PRD §2 makes "month-end stock variance
  explainable" a success metric.
- Fresh flowers are bought close to the delivery date; deducting at confirmation
  for an event two weeks out removes stock not yet purchased and drives the
  ledger negative for no real reason.
- Walk-in trade keeps seeing true availability.
- An order cancelled before delivery never deducted, so nothing must be unwound.

Trade-off: stock is not reserved, so confirmed orders can be oversold.
Commitments stay visible in the upcoming-deliveries view.

**CONFIRMED** by the project owner. To change it later:
`update company_settings set stock_deduction_point = 'order_confirmed';`
If it is ever switched to confirmation, the cancellation path needs a decision too —
goods on a cancelled-but-undelivered order are either a return or wastage, and that
is a business question, not a technical one.

## Standing decisions on open PRD questions

The project owner has approved recommending and implementing an answer rather than
leaving a module inert, provided the choice is reversible in settings, documented,
and flagged for client sign-off. Decisions taken so far:

| PRD   | Question                    | Decision                                                                                                                   | How to change it                                        |
| ----- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| §12.4 | Stock deduction point       | **Delivery** — confirmed by the owner                                                                                      | `company_settings.stock_deduction_point`                |
| §12.3 | VAT registration and rate   | **Not registered, VAT off**, rate seeded at 16% and inert                                                                  | `update tax_config set is_vat_enabled = true`           |
| §12.2 | Wholesale vs retail pricing | **Price by client type**, `product_prices` overriding `products.selling_price_cents`; empty table means everyone pays list | Add rows to `product_prices`                            |
| §12.5 | Sales commissions           | **None** — payroll ships without them                                                                                      | New tables; a v2 addition if the client pays commission |

### Why VAT defaults to off

The two mistakes are not symmetrical. Charging VAT the business is not registered to
collect is unlawful and has to be refunded to every customer; omitting VAT it owes is
a correctable filing matter. Off is the recoverable error. What matters is that
switching it on is a settings change: `tax_config` carries the rate, the effective
date and the categories, and `features/invoices/vat.ts` reads them — no rate is
written in code. Verified by a test that flips the setting and sees VAT appear on a
converted invoice.

### Why pricing is by client type

`product_prices (product_id, client_type)` already exists in the schema and the PRD's
client types — individual, corporate, event planner — are exactly the wholesale/retail
split a florist needs. It is additive: an empty table is today's behaviour, so the
decision costs nothing if the client says they have one price list.

### Why commissions are not built

It is the only open question that needs new tables, and commission structures vary too
widely to guess — percentage of sale, of margin, tiered, or per product. Getting it
wrong means payroll is wrong. "No commission" is a real and common answer, and it is
what the system does today, so shipping without it is a position rather than a gap.

## Open questions still unanswered (PRD §12)

Everything that was a _decision_ has been decided — see "Standing decisions" above.
What remains needs facts only the client has, and cannot be recommended:

| #   | Question                                | Needed before | Why it cannot be recommended                                                        |
| --- | --------------------------------------- | ------------- | ----------------------------------------------------------------------------------- |
| 6   | M-Pesa paybill/till and bank details    | Go-live       | Real account numbers. Invoices currently print demo values on the local stack only. |
| 7   | eTIMS obligation                        | v2 planning   | Their accountant's call. The KRA PIN is already on documents, so it stays additive. |
| 8   | ODPC registration status                | Go-live       | A registration fact, not a design choice. Payroll data is already role-gated.       |
| 1   | Business model and product range detail | Training      | Copy and seed data only; nothing in the schema waits on it.                         |

None of these block a module. #6 blocks issuing a real invoice to a real customer.

## Marketing website (§10.3) — built, awaiting client facts

One static page at `apps/website`, exported to plain files. No JavaScript ships:
the reveals and the header are CSS scroll-driven animations, so there is nothing
to hydrate and nothing that can leave the page blank if a script fails.

| Piece                | Where                                                   |
| -------------------- | ------------------------------------------------------- |
| Page sections        | `components/` — Hero, Varieties, Process, Farm, Enquiry |
| All business facts   | `content/site.ts` — the only file holding one           |
| Photography pipeline | `scripts/build-photos.mjs` + `photos.manifest.json`     |
| Generated photo data | `content/photos.ts` — do not edit by hand               |
| Content gate         | `scripts/check-content.mjs`, runs as part of `build`    |
| Privacy notice       | `app/privacy/page.tsx` (PRD §9)                         |

### Decisions taken, for client sign-off

**1. The business is a cut-foliage grower, not a florist.** PRD §12 question 1.
The twenty photographs supplied contain no flowers: they are eucalyptus field
beds, the harvest, stems graded and tied into bunches, and stock held in the
packing shed. `docs/brand.md` said the site should use "photography of real
flowers", which does not match anything the client sent. Confirmed with the
project owner before building. The site sells supply to florists, decorators and
wholesalers. If this is wrong, the page content is wrong and `content/site.ts`
plus `docs/brand.md` are the two files to change.

**2. WhatsApp is the only call to action.** No contact form was built, so
`website_contact_messages` stays unused and the `anon` role reaches nothing at
all. That is a smaller attack surface than the PRD assumed, not a larger one. A
form can be added later without touching the layout, but `app/privacy/page.tsx`
would have to be revised in the same change, because it currently states as fact
that the site collects nothing.

**3. Unknown facts render as nothing, never as a placeholder.** Every business
fact in `content/site.ts` is `null` until confirmed, and each component omits a
null field rather than printing a dash or "TBD". `pnpm --filter @rasko/website
content` lists what is outstanding, and the build fails while the WhatsApp
number is missing, because a page whose only action does nothing is worse than
no page.

**4. Two varieties are described, not named.** The photographs show a silver-blue
variety and one with pink and bronze new growth. The cultivars were not
confirmed, so the page calls them "Silver-blue eucalyptus" and "Pink-tipped
eucalyptus", which describe what is in the frame. `tradeName` and
`botanicalName` in `content/site.ts` take over as soon as they are filled in.

**5. Baby Blue confirmed as the specialty.** Project owner, 2026-09-23. The
silver-blue variety is _Eucalyptus pulverulenta_, traded as "Baby Blue"; both
names are now set in `content/site.ts` and render on the page. Note for the
client conversation: Baby Blue is a **foliage** crop. Its actual blossom is a
small cream tuft and nothing like the product, so the site sells foliage. If the
business really does sell blossom, the Varieties section is wrong.

**6. Licensed reference photography added.** Two Baby Blue images from Wikimedia
Commons (CC0, Peter Chadzidocev; Public domain, Daderot) sit in a clearly
labelled, recessed strip that states in as many words that they are reference
and not our crop, each with its credit. Scraped or unlicensed stock was refused:
it carries copyright, and passing another grower's plants off as Rasko's is the
thing the whole content design exists to prevent. Replace both the moment the
farm shoots its own close-range Baby Blue photographs.

_Superseded 2026-09-23:_ both reference photographs and their credits were
removed at the project owner's instruction (decision 8). The originals remain
in `apps/website/reference/` but nothing on the site uses them.

**7. The site now ships JavaScript.** Project owner's instruction, 2026-09-23.
GSAP, Framer Motion and three.js take First Load JS from 102 kB to 287 kB. The
cost was flagged before building, given the buyers are Kenyan trade customers on
phones. The no-JavaScript floor was preserved: no hidden state in CSS, verified
in-browser with every inline style stripped, 17 animated elements, 0 invisible.

### Deferred, revisit with the client

**WhatsApp prefill wording.** Raised 2026-09-12, parked by the project owner.
The composer currently opens with a plain greeting. The alternative is a
template carrying the enquiry checklist as blank lines, so messages arrive
structured. Saves two round trips per enquiry; costs the buyers who see a form
and close it. One-line change at `enquiry.prefill` in
`apps/website/content/site.ts`, which is commented with the same reasoning.

### Outstanding, blocking publication

- `contact.whatsapp` and `contact.phoneDisplay` — the build refuses without them

### Outstanding, not blocking

Stem length, bunch size, vase life and availability for both varieties; weekly
output, planted area and cutting days; minimum order, lead time, delivery,
packing and payment terms; the farm's area, an email address and opening hours.
23 fields in total. Run `pnpm --filter @rasko/website content` for the live list.

### Not done

- Final logo art. The header is the wordmark set in Lora, which is a reasonable
  interim and is not the placeholder monogram. Dropping real art in means
  changing `SiteHeader.tsx` only.
- Open Graph share image. There is no logo to build one from yet.
- The site has not been checked on a physical phone. It was verified at a true
  390px viewport in a browser, which is not the same as a real device.

## Suppliers & purchases (FR-7.1 – FR-7.6) — done

| Requirement                       | Where                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| FR-7.1 supplier record            | `SupplierForm.tsx`; payment terms drive the default due date on a purchase                     |
| FR-7.2 purchase + lines, statuses | `PurchaseForm.tsx`; `ordered → received → paid`, forward only                                  |
| FR-7.3 receipt writes stock       | `app.receive_purchase_into_stock` (server). The device only sets `received_at`                 |
| FR-7.4 payments + aging           | `recordPayment()`, `payablesAging()` — same buckets as receivables                             |
| FR-7.5 owner/manager/accountant   | `canWriteSuppliers` mirrors `app.is_staff`; accountant reads and may record a supplier payment |
| FR-7.6 stock only after receipt   | Pipeline refuses to step back out of `received`                                                |

**Nothing here writes a stock movement.** The server trigger owns them and is
idempotent against a unique index. A device writing them too would double-count
the moment two devices received the same purchase offline.

**FR-7.3 cost update stays off.** `company_settings.update_cost_on_receipt` is
false. Movements always store `unit_cost_cents`, so valuation is correct either
way; turning it on lets one odd purchase whipsaw the catalogue cost.

## Employees & payroll (FR-8.1 – FR-8.9) — done

| Requirement               | Where                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------- |
| FR-8.1 employee record    | `EmployeeForm.tsx`; national ID unique; phone matches the table CHECK before save       |
| FR-8.2 allowances         | `employees.allowances` jsonb, configurable per employee                                 |
| FR-8.3 advances           | Requested by owner/manager, approved by owner, recovered once via `recovered_in_run_id` |
| FR-8.4 monthly run        | `statutory.ts` + `prepareRun()`                                                         |
| FR-8.5 prepare vs approve | Accountant prepares; owner approves; `app.guard_payroll_approval` enforces              |
| FR-8.6 payslip            | `PayslipDocument.tsx` — A4, shows its working                                           |
| FR-8.7 mark paid          | `markPaid()`, per employee or whole run                                                 |
| FR-8.8 visibility         | Owner full, manager read-only, accountant prepares, sales never                         |
| FR-8.9 commissions        | **Not built** — no commission structure supplied (PRD §12.5). v2                        |

**The deduction order is the part people get wrong.** NSSF, SHIF and the Housing
Levy come off gross _before_ PAYE, per the Tax Laws (Amendment) Act 2024.
Computing PAYE on gross overstates tax for every employee; a test asserts the
correct figure is lower. Which deductions precede PAYE is itself configurable
(`deductions_before_tax`), so the next amendment is a settings change.

**No rate is a constant.** Every figure comes from `statutory_rates`, and a run
snapshots the whole set, so reprinting an old payslip reproduces the original
numbers rather than recomputing against today's law.

## Dashboard & reports (FR-2.1 – FR-2.8) — done

| Requirement              | Where                                                                    |
| ------------------------ | ------------------------------------------------------------------------ |
| FR-2.1 daily summary     | `dailySummary()`, today in Africa/Nairobi (UTC+3, no DST)                |
| FR-2.2 30-day trend      | `SalesTrendChart.tsx` — inline SVG, no chart library, brand colours only |
| FR-2.3 top 5 / top 5     | `topClients()`, `topProducts()` — ranked by value, not volume            |
| FR-2.4 receivables aging | `receivablesAging()`                                                     |
| FR-2.5 payables          | `payablesTotalCents()`                                                   |
| FR-2.6 stock alerts      | `lowStockAlerts()` (negative first), `wastageAlert()`                    |
| FR-2.7 CSV export        | `toCsv()` — RFC 4180 quoting; PDF via the print path                     |
| FR-2.8 role scoping      | `scope()` narrows the query; RLS is what actually enforces it            |

## Settings, audit & system (FR-9.1 – FR-9.6) — done

| Requirement            | Where                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| FR-9.1 company profile | `SettingsScreen.tsx` Company tab — the details that print on documents   |
| FR-9.2 tax config      | Tax tab; VAT refuses to switch on without registration **and** a KRA PIN |
| FR-9.3 statutory rates | A change is a new row with its own effective date, never an edit         |
| FR-9.4 sync indicator  | Shell top bar (done earlier)                                             |
| FR-9.5 system screen   | System tab: version, last sync, queued and failed writes                 |
| FR-9.6 audit log       | `AuditLogScreen.tsx`, owner and manager only, filtered                   |

**This module is where PRD §12 stops being a developer task.** VAT, the
statutory rates, the stock deduction point and the M-Pesa and bank details are
all rows the owner edits.

**8. Baby Blue only; green page, white header; one card size.** Project owner,
2026-09-23. The pink-tipped variety is off the site (reversible: restore its
entry in `content/site.ts`), the Wikimedia reference photographs are gone, and
the enquiry checklist no longer asks which variety. Everything below the white
header sits on Rasko Green, and the header carries no WhatsApp button. Every
photograph below the hero is a `PhotoCard`, one column of a four-column grid
at a 3:4 ratio, so all cards render at one size. Needs client sign-off.

**10. Four varieties, 20px cards, map shown directly.** Project owner,
2026-09-24, superseding the "Baby Blue only" part of 8. The site lists Baby
Blue, Gunni, Parvifolia and Globulus, one card each from the client's named
photographs; the separate one-stem card is gone to keep the row of four even.
Botanical names follow the trade names (E. pulverulenta, gunnii, parvifolia,
globulus) and need client confirmation. Website cards use a 20px radius (the
app keeps its 8px token). The Google map now loads with the page instead of on
click, and the privacy notice says so. It is pinned at -0.3542512, 35.6862408,
the location the owner shared on Google Maps (a live-location share, so the
coordinate is stored, not the link). The "In the field" card in the farm
section shows the client's plantation photograph. Needs client sign-off.

**9. Stacked RSS monogram and slogan.** Project owner, 2026-09-24. The logo is
now the client's recreation of the original printed monogram
(`docs/brand/logo.svg`, #134B21), replacing the overlapping-letter mark. The
slogan "All that nature gives." leads the hero beside the monogram, which
draws itself on load (GSAP DrawSVG) while the slogan scramble-reveals word
by word and replays every few seconds (ScrambleText, owner's choice) over leaves falling in three.js. App icons are not yet
regenerated from the new logo: run `pnpm --filter @rasko/app icon`.

**10. Farm location and map card.** Project owner, 2026-09-24. The farm's area
is Molo, Nakuru County (`content/site.ts`, now shown in the footer). A card
above the footer maps "Molo, Nakuru County, Kenya", an area rather than a
pin, since no exact location has been given. The Google frame is created only
when a visitor presses Show map, so the site still contacts no third party
by default; the privacy notice was revised in the same change to say so.

**11. Search visibility.** Project owner, 2026-09-24. Brand-first title and
keyword description, one brand h1, LocalBusiness + WebSite JSON-LD, robots.txt,
sitemap.xml and share cards. The domain (`site.url`) is still unconfirmed and
gates the canonical link, sitemap entries and share image. The off-site steps
that decide ranking (Google Business Profile, Search Console, listings) are in
`docs/seo.md` and need the business to act.
