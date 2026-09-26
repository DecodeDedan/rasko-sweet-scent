# Architecture — Rasko Sweet Scent

Version: 1.0-draft · Date: 1st September 2026 · Companion to `docs/prd.md`

This document turns the PRD into an implementable schema. Where the PRD carries an
`[FILL IN]`, this document defines a structure that accommodates either answer and
records the decision as open in §10 — it never guesses.

Every requirement reference (`FR-x.x`, `NFR-Sx`, `Tx`) points at `docs/prd.md`.
If the two disagree, the PRD wins and this document is wrong.

Implementation order: this document (Prompt 1) → versioned Supabase migrations
(Prompt 3). No migration should introduce a table or column that is not described here.

---

## 1. Conventions

| Concern                | Rule                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary keys           | `uuid`, **generated on the client** (`gen_random_uuid()` server-side as a fallback default). Client generation is what makes offline creation and idempotent retry possible — see §6.4. |
| Timestamps             | `timestamptz`, always UTC in storage. Displayed in `Africa/Nairobi`, formatted `DD/MM/YYYY`.                                                                                            |
| Money                  | `bigint`, **integer cents**, never `numeric`, never floating point. A column named `*_cents` holds cents. Displayed `KES 12,500.00`.                                                    |
| Percentages / rates    | integer **basis points** (`_bp`), e.g. VAT 16% = `1600`. Avoids float drift in tax arithmetic.                                                                                          |
| Quantities             | `numeric(12,3)`. Stems and bundles are counted, but flowers are also sold by partial bundle; three decimals is enough and exact under Postgres `numeric`.                               |
| Soft delete            | `deleted_at timestamptz null`. **Rows are never hard-deleted** (NFR-S5) — a hard delete cannot be communicated to an offline device.                                                    |
| Row lifecycle          | `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by` on every business table.                                                                                           |
| `updated_at` authority | Set **only** by a server trigger (§6.3). Device clocks are never trusted for sync ordering.                                                                                             |
| Status fields          | `text` with a `CHECK` constraint, not Postgres enums — a `CHECK` can be altered in a migration without the enum-type dance, and SQLite mirrors it directly.                             |
| Phone numbers          | `text`, stored `+2547...` E.164. A `CHECK (phone ~ '^\+254[17]\d{8}$')` on write-facing columns.                                                                                        |
| Naming                 | tables plural snake_case; foreign keys `<singular>_id`; booleans `is_*`/`has_*`.                                                                                                        |

### 1.1 Columns every synced table carries

```sql
id           uuid        primary key default gen_random_uuid(),
created_at   timestamptz not null default now(),
updated_at   timestamptz not null default now(),  -- server trigger owns this
deleted_at   timestamptz,
created_by   uuid        references profiles(id),
updated_by   uuid        references profiles(id)
```

Referred to below as **`«base»`** rather than repeated in every table.

---

## 2. Data model

### 2.1 profiles (FR-1.3, FR-1.4)

Mirrors `auth.users`. Supabase Auth owns credentials; this table owns role and status.

| Column                 | Type          | Constraints                                                          | Notes                                                                       |
| ---------------------- | ------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`                   | `uuid`        | PK, `references auth.users(id) on delete restrict`                   | Same id as the auth user.                                                   |
| `full_name`            | `text`        | not null                                                             |                                                                             |
| `email`                | `text`        | not null, unique (citext-style lower index)                          | Denormalised for pickers; auth remains source of truth.                     |
| `phone`                | `text`        |                                                                      | E.164.                                                                      |
| `role`                 | `text`        | not null, `check (role in ('owner','manager','accountant','sales'))` | Only `owner` may change this (§5).                                          |
| `is_active`            | `boolean`     | not null default true                                                | Deactivation revokes access server-side (FR-1.4, T4).                       |
| `must_change_password` | `boolean`     | not null default true                                                | Invited users (FR-1.6).                                                     |
| `deactivated_at`       | `timestamptz` |                                                                      |                                                                             |
| `«base»`               |               |                                                                      | No `deleted_at` use — deactivate, never delete, so history keeps resolving. |

Deactivation is a two-part action and both parts are required (T4):

1. `profiles.is_active = false` — every RLS policy tests it, so an offline device loses
   all server access on its next sync even though its cached session is still valid.
2. Revoke the refresh token via the Admin API so the JWT cannot be renewed.

### 2.2 clients (FR-3.1 – FR-3.6)

| Column              | Type      | Constraints                                                     | Notes                                                                       |
| ------------------- | --------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `name`              | `text`    | not null                                                        |                                                                             |
| `client_type`       | `text`    | not null, `check in ('individual','corporate','event_planner')` | FR-3.1.                                                                     |
| `phone`             | `text`    |                                                                 | E.164; indexed for search (FR-3.2).                                         |
| `email`             | `text`    |                                                                 |                                                                             |
| `kra_pin`           | `text`    |                                                                 | Optional, mainly corporate.                                                 |
| `address`           | `text`    |                                                                 |                                                                             |
| `credit_terms_days` | `integer` | not null default 0, `check (>= 0)`                              | Drives receivables aging (FR-2.4).                                          |
| `notes`             | `text`    |                                                                 |                                                                             |
| `«base»`            |           |                                                                 | `created_by` is load-bearing: it is the RLS predicate for `sales` (FR-3.4). |

**Walk-in sales (FR-3.6)** do not create a client. `orders.client_id` is nullable and
`orders.is_walk_in` is true instead — see §2.3. A synthetic "Walk-in" client row was
rejected because it would corrupt lifetime-value and top-client reporting (FR-2.3, FR-3.3).

**FR-3.5** (no soft-delete while unpaid invoices exist) is a `BEFORE UPDATE` trigger, not
application logic, because an offline device cannot see other devices' invoices:

```sql
-- rejects the delete when any non-voided invoice for this client has a balance
create trigger clients_block_delete_with_balance before update on clients
  when (new.deleted_at is not null and old.deleted_at is null) ...
```

### 2.3 orders (FR-4.1 – FR-4.7)

| Column                                                  | Type          | Constraints                                                                                                           | Notes                                                                                                                                                         |
| ------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order_number`                                          | `text`        | unique                                                                                                                | Display reference. **Not** gap-free — only invoices carry that obligation (FR-5.1). Format `ORD-YYYY-NNNN`, assigned server-side by the same mechanism as §8. |
| `client_id`                                             | `uuid`        | `references clients(id)`, nullable                                                                                    | Null when `is_walk_in`.                                                                                                                                       |
| `is_walk_in`                                            | `boolean`     | not null default false, `check (is_walk_in = (client_id is null))`                                                    | Keeps the two fields honest.                                                                                                                                  |
| `status`                                                | `text`        | not null default `'draft'`, `check in ('draft','confirmed','in_production','ready','delivered','closed','cancelled')` | FR-4.2.                                                                                                                                                       |
| `order_type`                                            | `text`        | not null default `'standard'`, `check in ('standard','event')`                                                        | FR-4.3.                                                                                                                                                       |
| `subtotal_cents`                                        | `bigint`      | not null default 0                                                                                                    | Sum of line items. Maintained by trigger from `order_items`, never hand-edited.                                                                               |
| `discount_cents`                                        | `bigint`      | not null default 0, `check (>= 0)`                                                                                    | Order-level discount.                                                                                                                                         |
| `total_cents`                                           | `bigint`      | not null default 0                                                                                                    | `subtotal - discount`.                                                                                                                                        |
| `delivery_at`                                           | `timestamptz` |                                                                                                                       | Date **and** time (FR-4.1); powers the upcoming-deliveries view (FR-4.7).                                                                                     |
| `delivery_address`                                      | `text`        |                                                                                                                       |                                                                                                                                                               |
| `event_date`                                            | `date`        |                                                                                                                       | FR-4.3, event orders only.                                                                                                                                    |
| `event_venue`                                           | `text`        |                                                                                                                       |                                                                                                                                                               |
| `event_setup_notes`                                     | `text`        |                                                                                                                       |                                                                                                                                                               |
| `notes`                                                 | `text`        |                                                                                                                       |                                                                                                                                                               |
| `taken_by`                                              | `uuid`        | `references profiles(id)`, not null                                                                                   | FR-4.1. Distinct from `created_by`: an order can be entered by one person on behalf of another.                                                               |
| `confirmed_at`                                          | `timestamptz` |                                                                                                                       | Stock deduction point candidate (FR-6.6, open — §10).                                                                                                         |
| `delivered_at`                                          | `timestamptz` |                                                                                                                       | The other candidate.                                                                                                                                          |
| `cancelled_at` / `cancelled_by` / `cancellation_reason` |               |                                                                                                                       | Cancellation needs manager or owner (FR-4.2), enforced in RLS + trigger.                                                                                      |
| `«base»`                                                |               |                                                                                                                       |                                                                                                                                                               |

`total_cents` is a _cached_ aggregate of child rows, not a user-editable field. It is
recomputed by trigger on `order_items` change. This is different from invoice balance,
which is never stored at all (§3) — the distinction is that line items are immutable-ish
inputs owned by the same device, whereas payments arrive independently from other devices.

### 2.4 order_items (FR-4.1)

| Column             | Type            | Constraints                         | Notes                                                                                                  |
| ------------------ | --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `order_id`         | `uuid`          | not null, `references orders(id)`   |                                                                                                        |
| `product_id`       | `uuid`          | `references products(id)`, nullable | Null for a custom arrangement.                                                                         |
| `description`      | `text`          | not null                            | Free text for custom arrangements; **snapshot of the product name** otherwise.                         |
| `quantity`         | `numeric(12,3)` | not null, `check (> 0)`             |                                                                                                        |
| `unit_price_cents` | `bigint`        | not null, `check (>= 0)`            | **Snapshot at order time.** A later price change must never alter a historical order.                  |
| `discount_cents`   | `bigint`        | not null default 0                  |                                                                                                        |
| `line_total_cents` | `bigint`        | not null                            | `round(quantity * unit_price) - discount`, computed in a trigger so client and server cannot disagree. |
| `position`         | `integer`       | not null default 0                  | Stable print ordering.                                                                                 |
| `«base»`           |                 |                                     |                                                                                                        |

Snapshotting `description` and `unit_price_cents` is deliberate: FR-5.2 requires an invoice
PDF to be reproducible years later, and products are mutable.

### 2.5 invoices (FR-5.1, FR-5.2, FR-5.6)

| Column                                    | Type      | Constraints                                                        | Notes                                                                                                                  |
| ----------------------------------------- | --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `invoice_number`                          | `text`    | **unique**, nullable until numbered                                | `INV-YYYY-NNNN`. Server-assigned, gap-free — see §8. Null means "created offline, not yet numbered".                   |
| `order_id`                                | `uuid`    | `references orders(id)`, nullable                                  | FR-4.4 conversion; nullable because an invoice can be raised directly.                                                 |
| `client_id`                               | `uuid`    | `references clients(id)`, nullable                                 | Null for a walk-in sale.                                                                                               |
| `client_snapshot`                         | `jsonb`   | not null                                                           | Name, address, phone, KRA PIN **as at issue**. The invoice PDF must not change when the client record is later edited. |
| `company_snapshot`                        | `jsonb`   | not null                                                           | Company profile + payment instructions at issue (FR-5.2, FR-9.1). Same reasoning.                                      |
| `status`                                  | `text`    | not null default `'draft'`, `check in ('draft','issued','voided')` | See the note below — this is **not** the FR-5.6 list.                                                                  |
| `issue_date`                              | `date`    | not null                                                           |                                                                                                                        |
| `due_date`                                | `date`    | not null                                                           | `issue_date + clients.credit_terms_days` at issue.                                                                     |
| `subtotal_cents`                          | `bigint`  | not null                                                           |                                                                                                                        |
| `discount_cents`                          | `bigint`  | not null default 0                                                 |                                                                                                                        |
| `vat_rate_bp`                             | `integer` | not null default 0                                                 | Snapshot of the rate applied (FR-9.2).                                                                                 |
| `vat_cents`                               | `bigint`  | not null default 0                                                 |                                                                                                                        |
| `total_cents`                             | `bigint`  | not null                                                           | Amount owed. Immutable once `issued`.                                                                                  |
| `voided_at` / `voided_by` / `void_reason` |           |                                                                    | A voided invoice **keeps its number** — that is how "never reused" (FR-5.1) coexists with "gap-free".                  |
| `«base»`                                  |           |                                                                    |                                                                                                                        |

**Why `status` has three values and FR-5.6 lists six.** FR-5.6's `unpaid`, `partially paid`,
`paid` and `overdue` are _functions of payments and today's date_, not independent state.
Storing them would create a value that drifts the moment a payment syncs from another
device, and "overdue" would need a nightly job to stay true. They are computed in the
`invoice_status` view (§3.1). The stored column carries only what a human actually sets.

### 2.6 payments (FR-5.3 – FR-5.5) — append-only

| Column                     | Type          | Constraints                                                    | Notes                                                                    |
| -------------------------- | ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `invoice_id`               | `uuid`        | not null, `references invoices(id)`                            |                                                                          |
| `amount_cents`             | `bigint`      | not null, `check (> 0)`                                        | Always positive. A correction is a `reversal`, never a negative payment. |
| `method`                   | `text`        | not null, `check in ('mpesa','cash','bank_transfer','cheque')` | FR-5.3.                                                                  |
| `reference`                | `text`        |                                                                | M-Pesa code, cheque number, bank reference.                              |
| `paid_at`                  | `timestamptz` | not null                                                       | When the money moved, which is not when the row was created.             |
| `received_by`              | `uuid`        | not null, `references profiles(id)`                            | FR-5.3.                                                                  |
| `notes`                    | `text`        |                                                                |                                                                          |
| `created_at`, `created_by` |               |                                                                | **No `updated_at`, no `updated_by`, no `deleted_at`.**                   |

The absent columns are the design. Payments are **insert-only at every layer**: no UPDATE
or DELETE policy exists for any role (§5.3), and a trigger raises on both to close the
table-owner bypass. This is what makes T3 safe — two devices recording payments offline
against the same invoice produce two independent inserts that both survive, and the
balance is a sum, so nothing is lost and nothing needs merging.

### 2.7 reversals (FR-5.5)

| Column                     | Type          | Constraints                         | Notes                                                  |
| -------------------------- | ------------- | ----------------------------------- | ------------------------------------------------------ |
| `payment_id`               | `uuid`        | not null, `references payments(id)` |                                                        |
| `amount_cents`             | `bigint`      | not null, `check (> 0)`             | Positive; subtracted when computing balance.           |
| `reason`                   | `text`        | not null                            | Required — a reversal without a reason is unauditable. |
| `reversed_at`              | `timestamptz` | not null default now()              |                                                        |
| `created_at`, `created_by` |               |                                     | Also append-only.                                      |

Constraint: total reversals against a payment may not exceed it. Enforced by trigger
(`sum(reversals.amount) <= payments.amount`), because a `CHECK` cannot span rows.
Restricted to `manager` and `owner` (FR-5.5).

### 2.8 categories (FR-6.1)

| Column       | Type      | Constraints           | Notes                                                                    |
| ------------ | --------- | --------------------- | ------------------------------------------------------------------------ |
| `name`       | `text`    | not null, unique      |                                                                          |
| `slug`       | `text`    | not null, unique      | `fresh_flowers`, `arrangements`, `vases`, `accessories`, `other` seeded. |
| `is_vatable` | `boolean` | not null default true | FR-9.2 allows VAT per category.                                          |
| `position`   | `integer` | not null default 0    |                                                                          |
| `«base»`     |           |                       |                                                                          |

A table rather than a `CHECK` constraint: FR-9.2 attaches VAT applicability to categories,
which makes them data the owner edits, not a fixed code-level list.

### 2.9 products (FR-6.1, FR-6.3)

| Column                | Type            | Constraints                                    | Notes                                                              |
| --------------------- | --------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `sku`                 | `text`          | not null, unique                               |                                                                    |
| `name`                | `text`          | not null                                       |                                                                    |
| `category_id`         | `uuid`          | not null, `references categories(id)`          |                                                                    |
| `unit`                | `text`          | not null, `check in ('stem','bundle','piece')` | FR-6.1.                                                            |
| `cost_price_cents`    | `bigint`        | not null default 0, `check (>= 0)`             | Current cost, for valuation (FR-6.8).                              |
| `selling_price_cents` | `bigint`        | not null default 0, `check (>= 0)`             | Default price; overridable per client type — see `product_prices`. |
| `low_stock_threshold` | `numeric(12,3)` | not null default 0                             | FR-6.4.                                                            |
| `is_active`           | `boolean`       | not null default true                          | Hide from pickers without breaking history.                        |
| `«base»`              |                 |                                                |                                                                    |

**There is no `current_stock` column.** FR-6.2 makes stock a function of movements; a
stored copy would be a second source of truth that two offline devices could each update
and neither could merge. Read it from the `product_stock` view (§3.2).

### 2.10 product_prices (FR-6.3 — structure only, model open)

| Column        | Type     | Constraints                                                     | Notes |
| ------------- | -------- | --------------------------------------------------------------- | ----- |
| `product_id`  | `uuid`   | not null, `references products(id)`                             |       |
| `client_type` | `text`   | not null, `check in ('individual','corporate','event_planner')` |       |
| `price_cents` | `bigint` | not null, `check (>= 0)`                                        |       |
|               |          | unique `(product_id, client_type)`                              |       |

Present so that wholesale/retail pricing is additive rather than a migration of every
order. **Empty until FR-6.3 is answered** (§10). Price resolution is: matching
`product_prices` row → else `products.selling_price_cents`.

### 2.11 stock_movements (FR-6.2, FR-6.5, FR-6.7) — append-only

| Column                     | Type            | Constraints                                                                 | Notes                                                                                                                                       |
| -------------------------- | --------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `product_id`               | `uuid`          | not null, `references products(id)`                                         |                                                                                                                                             |
| `movement_type`            | `text`          | not null, `check in ('purchase_in','sale','wastage','adjustment','return')` | FR-6.2.                                                                                                                                     |
| `quantity`                 | `numeric(12,3)` | not null, `check (quantity <> 0)`                                           | **Signed.** Positive for `purchase_in`/`return`, negative for `sale`/`wastage`, either for `adjustment`. A further CHECK ties sign to type. |
| `unit_cost_cents`          | `bigint`        |                                                                             | Cost at movement time; drives valuation (FR-6.8).                                                                                           |
| `source_table`             | `text`          | `check in ('orders','purchases','manual')`                                  |                                                                                                                                             |
| `source_id`                | `uuid`          |                                                                             | The order or purchase that caused it.                                                                                                       |
| `reason`                   | `text`          |                                                                             | **Required** for `wastage` and `adjustment` (trigger-enforced, FR-6.2/FR-6.5).                                                              |
| `occurred_at`              | `timestamptz`   | not null                                                                    |                                                                                                                                             |
| `created_at`, `created_by` |                 |                                                                             | Append-only: no update, no delete. A wrong movement is corrected by an opposing `adjustment`, exactly like a payment reversal.              |

Signed quantity means current stock is `sum(quantity)` — one index-only aggregate rather
than a `CASE` over movement types. Negative results are allowed and surfaced for review
(FR-6.7); they are not an error condition.

Unique constraint `(source_table, source_id, product_id, movement_type)` where
`source_table <> 'manual'`. This is what makes stock deduction **idempotent**: replaying a
sync, or confirming an order twice, cannot double-deduct (T6).

### 2.12 suppliers (FR-7.1)

| Column               | Type      | Constraints        |
| -------------------- | --------- | ------------------ |
| `name`               | `text`    | not null           |
| `contact_person`     | `text`    |                    |
| `phone`              | `text`    | E.164              |
| `email`              | `text`    |                    |
| `payment_terms_days` | `integer` | not null default 0 |
| `kra_pin`            | `text`    |                    |
| `notes`              | `text`    |                    |
| `«base»`             |           |                    |

### 2.13 purchases (FR-7.2, FR-7.6)

| Column            | Type          | Constraints                                                                        | Notes                                                             |
| ----------------- | ------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `purchase_number` | `text`        | unique                                                                             | `PUR-YYYY-NNNN`, server-assigned.                                 |
| `supplier_id`     | `uuid`        | not null, `references suppliers(id)`                                               |                                                                   |
| `status`          | `text`        | not null default `'ordered'`, `check in ('ordered','received','paid','cancelled')` | FR-7.2.                                                           |
| `purchase_date`   | `date`        | not null                                                                           |                                                                   |
| `due_date`        | `date`        |                                                                                    | Payables aging (FR-2.5, FR-7.4).                                  |
| `total_cents`     | `bigint`      | not null default 0                                                                 | Trigger-maintained from `purchase_items`.                         |
| `received_at`     | `timestamptz` |                                                                                    | Setting this writes the `purchase_in` movements (FR-7.3, FR-7.6). |
| `«base»`          |               |                                                                                    |                                                                   |

Stock moves **only** on receipt (FR-7.6), driven by a trigger on the `received_at`
transition, not by the client, so an offline receipt and an online one behave identically.

### 2.14 purchase_items (FR-7.2)

| Column             | Type            | Constraints                          |
| ------------------ | --------------- | ------------------------------------ |
| `purchase_id`      | `uuid`          | not null, `references purchases(id)` |
| `product_id`       | `uuid`          | not null, `references products(id)`  |
| `quantity`         | `numeric(12,3)` | not null, `check (> 0)`              |
| `unit_cost_cents`  | `bigint`        | not null, `check (>= 0)`             |
| `line_total_cents` | `bigint`        | not null, trigger-computed           |
| `«base»`           |                 |                                      |

Whether receiving updates `products.cost_price_cents` is **open** (FR-7.3, §10). The
structure supports either: the movement always records `unit_cost_cents`, so valuation is
correct regardless, and the product-level write is a one-line trigger toggled by
`company_settings.update_cost_on_receipt`.

### 2.15 supplier_payments (FR-7.4) — append-only

| Column                     | Type          | Constraints                                                    |
| -------------------------- | ------------- | -------------------------------------------------------------- |
| `purchase_id`              | `uuid`        | not null, `references purchases(id)`                           |
| `amount_cents`             | `bigint`      | not null, `check (> 0)`                                        |
| `method`                   | `text`        | not null, `check in ('mpesa','cash','bank_transfer','cheque')` |
| `reference`                | `text`        |                                                                |
| `paid_at`                  | `timestamptz` | not null                                                       |
| `created_at`, `created_by` |               | Append-only, same rules as `payments`.                         |

### 2.16 employees (FR-8.1, FR-8.2)

| Column            | Type      | Constraints                                 | Notes                                                                                                                                                                  |
| ----------------- | --------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile_id`      | `uuid`    | `references profiles(id)`, nullable, unique | An employee is not necessarily a system user.                                                                                                                          |
| `full_name`       | `text`    | not null                                    |                                                                                                                                                                        |
| `national_id`     | `text`    | not null, unique                            |                                                                                                                                                                        |
| `kra_pin`         | `text`    |                                             |                                                                                                                                                                        |
| `nssf_number`     | `text`    |                                             |                                                                                                                                                                        |
| `shif_number`     | `text`    |                                             |                                                                                                                                                                        |
| `phone`           | `text`    |                                             | E.164                                                                                                                                                                  |
| `position`        | `text`    |                                             |                                                                                                                                                                        |
| `salary_type`     | `text`    | not null, `check in ('monthly','daily')`    | FR-8.1.                                                                                                                                                                |
| `basic_pay_cents` | `bigint`  | not null default 0                          | Monthly salary or daily rate per `salary_type`.                                                                                                                        |
| `allowances`      | `jsonb`   | not null default `'[]'`                     | `[{"code":"housing","label":"Housing","amount_cents":500000}]`. Configurable per employee (FR-8.2), so a fixed column set would not survive contact with the business. |
| `payment_method`  | `text`    | `check in ('mpesa','bank')`                 |                                                                                                                                                                        |
| `payment_details` | `jsonb`   |                                             | Till/phone or bank account.                                                                                                                                            |
| `is_active`       | `boolean` | not null default true                       |                                                                                                                                                                        |
| `«base»`          |           |                                             |                                                                                                                                                                        |

This table holds personal data under the Data Protection Act 2019 (PRD §9): it is readable
only by `owner` and `accountant`, and every read-path is role-gated in §5.

### 2.17 advances (FR-8.3)

| Column                          | Type     | Constraints                                                                            | Notes                                                           |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `employee_id`                   | `uuid`   | not null, `references employees(id)`                                                   |                                                                 |
| `amount_cents`                  | `bigint` | not null, `check (> 0)`                                                                |                                                                 |
| `requested_at` / `requested_by` |          |                                                                                        | Manager or owner (FR-8.3).                                      |
| `status`                        | `text`   | not null default `'pending'`, `check in ('pending','approved','rejected','recovered')` |                                                                 |
| `approved_at` / `approved_by`   |          |                                                                                        | **Owner only** (FR-8.3).                                        |
| `recovered_in_run_id`           | `uuid`   | `references payroll_runs(id)`                                                          | Set when deducted, which is what stops it being deducted twice. |
| `«base»`                        |          |                                                                                        |                                                                 |

### 2.18 payroll_runs (FR-8.4, FR-8.5)

| Column                        | Type      | Constraints                                                                               | Notes                                                                       |
| ----------------------------- | --------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `period_year`                 | `integer` | not null                                                                                  |                                                                             |
| `period_month`                | `integer` | not null, `check between 1 and 12`                                                        | unique `(period_year, period_month)` where not deleted — one run per month. |
| `status`                      | `text`    | not null default `'draft'`, `check in ('draft','prepared','approved','paid','cancelled')` |                                                                             |
| `prepared_at` / `prepared_by` |           |                                                                                           | Accountant or owner (FR-8.5).                                               |
| `approved_at` / `approved_by` |           |                                                                                           | **Owner only**, logged (FR-8.5).                                            |
| `rates_snapshot`              | `jsonb`   | not null                                                                                  | **The full statutory rate set used, copied in at preparation.**             |
| `totals`                      | `jsonb`   | not null default `'{}'`                                                                   | Gross, each deduction, net — for the run summary without re-aggregating.    |
| `«base»`                      |           |                                                                                           |                                                                             |

`rates_snapshot` is the most important column in the payroll module. PAYE bands, NSSF, SHIF
and the Housing Levy change by legislation (FR-9.3, PRD §9). Without a snapshot, reprinting
a payslip from eight months ago would recompute it against today's rates and produce a
different, wrong figure. With it, every historical payslip is reproducible byte-for-byte.

### 2.19 payroll_items (FR-8.4, FR-8.6)

One row per employee per run. All money `bigint` cents.

| Column                                                         | Type                                          | Notes                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `payroll_run_id`                                               | `uuid` not null `references payroll_runs(id)` | unique `(payroll_run_id, employee_id)`                                                                           |
| `employee_id`                                                  | `uuid` not null `references employees(id)`    |                                                                                                                  |
| `employee_snapshot`                                            | `jsonb` not null                              | Name, KRA PIN, NSSF/SHIF numbers, position at run time — payslips must not change when the employee record does. |
| `days_worked`                                                  | `numeric(5,2)`                                | For `daily` salary type.                                                                                         |
| `basic_pay_cents`                                              | `bigint` not null                             |                                                                                                                  |
| `allowances`                                                   | `jsonb` not null default `'[]'`               | Snapshot, itemised on the payslip.                                                                               |
| `gross_cents`                                                  | `bigint` not null                             |                                                                                                                  |
| `paye_cents`, `nssf_cents`, `shif_cents`, `housing_levy_cents` | `bigint` not null default 0                   | Statutory (FR-8.4).                                                                                              |
| `advance_deduction_cents`                                      | `bigint` not null default 0                   | FR-8.3.                                                                                                          |
| `other_deductions`                                             | `jsonb` not null default `'[]'`               |                                                                                                                  |
| `net_pay_cents`                                                | `bigint` not null                             |                                                                                                                  |
| `paid_at`, `payment_method`, `payment_reference`               |                                               | FR-8.7, set when marked paid.                                                                                    |
| `«base»`                                                       |                                               |                                                                                                                  |

Every component is stored rather than recomputed on read. Payroll arithmetic must be
auditable by the client's accountant against a paper computation (PRD §11), which means the
numbers on the payslip are the numbers in the database.

### 2.20 company_settings (FR-9.1) — single row

| Column                                                 | Type                                              | Notes                                                                           |
| ------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `id`                                                   | `uuid` PK                                         | Constrained to one row: `check (id = '00000000-0000-0000-0000-000000000001')`.  |
| `company_name`, `address`, `phone`, `email`, `kra_pin` | `text`                                            | Used on every document (FR-9.1).                                                |
| `logo_url`                                             | `text`                                            |                                                                                 |
| `is_vat_registered`                                    | `boolean` not null default false                  | **Open** (§10).                                                                 |
| `mpesa_paybill`, `mpesa_till`, `bank_details`          | `text` / `jsonb`                                  | Printed as payment instructions (FR-5.2). **Open** (§10).                       |
| `stock_deduction_point`                                | `text` `check in ('order_confirmed','delivered')` | **Open** (FR-6.6, §10). The schema does not care which; the trigger reads this. |
| `update_cost_on_receipt`                               | `boolean` not null default false                  | **Open** (FR-7.3, §10).                                                         |
| `«base»`                                               |                                                   |                                                                                 |

### 2.21 tax_config (FR-9.2)

| Column                    | Type                             | Notes                   |
| ------------------------- | -------------------------------- | ----------------------- |
| `is_vat_enabled`          | `boolean` not null default false |                         |
| `vat_rate_bp`             | `integer` not null default 1600  | Basis points.           |
| `effective_from`          | `date` not null                  |                         |
| `effective_to`            | `date`                           | Null = current.         |
| `applies_to_category_ids` | `uuid[]`                         | Empty = all categories. |
| `«base»`                  |                                  |                         |

Versioned by effective date for the same reason as statutory rates: an invoice reprinted
after a rate change must show the rate it was issued under.

### 2.22 statutory_rates (FR-9.3)

| Column           | Type                                                             | Notes                                                           |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `kind`           | `text` not null `check in ('paye','nssf','shif','housing_levy')` |                                                                 |
| `effective_from` | `date` not null                                                  | unique `(kind, effective_from)`                                 |
| `effective_to`   | `date`                                                           | Null = current.                                                 |
| `config`         | `jsonb` not null                                                 | Shape varies by kind — PAYE is banded, the levy is a flat rate. |
| `«base»`         |                                                                  |                                                                 |

```jsonc
// kind = 'paye'
{ "personal_relief_cents": 240000,
  "bands": [ { "upto_cents": 2880000, "rate_bp": 1000 },
             { "upto_cents": null,    "rate_bp": 3000 } ] }
// kind = 'housing_levy'
{ "rate_bp": 150, "cap_cents": null }
```

`jsonb` rather than columns because the four schemes have genuinely different shapes and
Kenyan law reshapes them periodically. Rates are **owner-editable data** (FR-9.3), never
constants in code. The application validates each shape on write.

### 2.23 audit_log — see §7.

### 2.24 sync bookkeeping

Two separate things, easily conflated:

**`sync_devices`** (server) — one row per installed device, for support and for T4.

| Column                         | Type                                      | Notes                                                                             |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------- |
| `id`                           | `uuid` PK                                 | Device id, generated at first launch, stored locally.                             |
| `profile_id`                   | `uuid` not null `references profiles(id)` |                                                                                   |
| `platform`                     | `text` `check in ('windows','android')`   |                                                                                   |
| `app_version`                  | `text`                                    | Surfaces "who is on an old build" (FR-9.5).                                       |
| `last_seen_at`                 | `timestamptz`                             |                                                                                   |
| `last_push_at`, `last_pull_at` | `timestamptz`                             |                                                                                   |
| `pending_count`                | `integer`                                 | Last reported outbox depth. Lets the owner see a device that has stopped syncing. |

**`sync_state`** (device-local SQLite only, never synced) — the pull cursors. Defined in §9.

### 2.25 website_contact_messages (PRD §7)

The only table the `anon` role can reach, and it can only insert.

| Column                              | Type                                 | Notes                                                    |
| ----------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| `id`                                | `uuid` PK                            |                                                          |
| `name`, `email`, `phone`, `message` | `text` not null (`phone` optional)   | Length-capped by CHECK to blunt abuse.                   |
| `captcha_token`                     | `text`                               | Verified by an edge function before the row is accepted. |
| `source_page`                       | `text`                               |                                                          |
| `handled_at`, `handled_by`          |                                      | Staff follow-up.                                         |
| `created_at`                        | `timestamptz` not null default now() |                                                          |

Not synced to devices — it is website-only data read in the admin UI online.

---

## 3. Derived values (views, not columns)

Every view is created `with (security_invoker = true)` so the caller's RLS applies. A
`security definer` view would silently hand a `sales` user the whole company's figures.

### 3.1 invoice_balances / invoice_status (FR-5.4, FR-5.6)

```sql
create view invoice_balances with (security_invoker = true) as
select i.id                                as invoice_id,
       i.total_cents,
       coalesce(p.paid_cents, 0)           as paid_cents,
       coalesce(r.reversed_cents, 0)       as reversed_cents,
       i.total_cents
         - coalesce(p.paid_cents, 0)
         + coalesce(r.reversed_cents, 0)   as balance_cents,
       i.currency
from invoices i
left join lateral (
  select sum(amount_cents) as paid_cents from payments where invoice_id = i.id
) p on true
left join lateral (
  select sum(rv.amount_cents) as reversed_cents
  from reversals rv join payments pm on pm.id = rv.payment_id
  where pm.invoice_id = i.id
) r on true
where i.deleted_at is null;
```

Every amount is in the invoice's `currency` (ISO 4217; payments and reversals have none of
their own), so no view ever sums money across currencies: those that aggregate group by it
(migration `20260930000300`). `invoice_status` also carries `currency`.

`invoice_status` layers FR-5.6 on top:

| Condition                    | Status           |
| ---------------------------- | ---------------- |
| `invoices.status = 'draft'`  | `draft`          |
| `invoices.status = 'voided'` | `voided`         |
| `balance_cents <= 0`         | `paid`           |
| `paid_cents > 0`             | `partially_paid` |
| `due_date < current_date`    | `overdue`        |
| otherwise                    | `unpaid`         |

`overdue` is evaluated at read time against `current_date`, so it is correct on a device
that has been offline for a week without any job needing to have run (FR-5.8).

### 3.2 product_stock (FR-6.2, FR-6.4, FR-6.7)

```sql
create view product_stock with (security_invoker = true) as
select p.id as product_id,
       coalesce(sum(m.quantity), 0)                          as current_stock,
       coalesce(sum(m.quantity), 0) <= p.low_stock_threshold as is_low_stock,
       coalesce(sum(m.quantity), 0) < 0                      as is_negative
from products p
left join stock_movements m on m.product_id = p.id
where p.deleted_at is null
group by p.id, p.low_stock_threshold;
```

**Performance note.** The PRD requires list screens under 500 ms at 5,000 records (§7).
This aggregate is over `stock_movements`, which grows without bound while `products` stays
small — so it is the one derived value with a real scaling ceiling. The covering index in
§4 keeps it index-only. If movement volume ever makes that insufficient, the escape hatch
is a `product_stock_rollup` table maintained by the same trigger that writes movements,
reconciled nightly — **not** a `current_stock` column on `products`, which would reintroduce
the merge conflict the append-only design exists to avoid.

### 3.3 Other reporting views

| View                  | Feeds          | Notes                                                                                                                                                                       |
| --------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client_balances`     | FR-3.3, FR-2.4 | One row per client and `currency`: outstanding plus aging buckets 0–30/31–60/61–90/90+ from `due_date`. A client with no issued invoice appears once, as `KES` with zeroes. |
| `supplier_balances`   | FR-2.5, FR-7.4 | `purchases.total_cents - sum(supplier_payments)`, same aging buckets.                                                                                                       |
| `daily_sales`         | FR-2.1, FR-2.2 | Grouped by day in `Africa/Nairobi` and by `currency`. Not UTC — a sale at 01:00 Nairobi belongs to that day, and grouping in UTC would file it under the previous one.      |
| `inventory_valuation` | FR-6.8         | `current_stock * cost_price_cents`.                                                                                                                                         |
| `wastage_report`      | FR-6.5         | `stock_movements` where `movement_type = 'wastage'`.                                                                                                                        |

---

## 4. Indexes

### 4.1 Sync indexes — on every synced table

```sql
create index <table>_sync_idx on <table> (updated_at, id);
```

Append-only tables (`payments`, `reversals`, `stock_movements`, `supplier_payments`)
have no `updated_at` by design — §2.6 — so their cursor and index use `(created_at, id)`
instead. They are insert-only, so the two are equivalent.

**`created_at` on those tables is server-owned**, for exactly the reason §6.3 gives for
`updated_at`: it is the cursor column, so a device with a fast clock would otherwise
write rows past every other device's cursor and they would stay invisible forever.
Migration `0015` forces `created_at := now()` on insert. Device time is preserved in the
columns that mean _when the thing happened_ — `paid_at`, `occurred_at` — never in sync
bookkeeping.

`audit_log` is the exception among append-only tables: it has no `created_at` at all,
carrying `occurred_at` (device) and `recorded_at` (server). Its cursor pages on
`recorded_at`, which `app.write_audit()` already sets to `now()`.

Non-negotiable, and the composite order matters. §6.2 pages by `(updated_at, id)` keyset
rather than `OFFSET`, and without this index every incremental pull is a sequential scan.

### 4.2 RLS-supporting indexes

RLS predicates become part of every query plan, so the columns they test need indexes:

```sql
create index clients_created_by_idx on clients (created_by);          -- FR-3.4 sales scope
create index orders_created_by_idx  on orders  (created_by);          -- FR-4.5
create index orders_taken_by_idx    on orders  (taken_by);            -- FR-2.8 own performance
```

### 4.3 Foreign keys and hot paths

```sql
create index order_items_order_idx      on order_items (order_id);
create index invoices_client_idx        on invoices (client_id) where deleted_at is null;
create index invoices_due_date_idx      on invoices (due_date) where status = 'issued';
create unique index invoices_number_idx on invoices (invoice_number) where invoice_number is not null;
create index payments_invoice_idx       on payments (invoice_id);
create index payments_paid_at_idx       on payments (paid_at desc);
create index reversals_payment_idx      on reversals (payment_id);

-- covering: lets product_stock aggregate without touching the heap
create index stock_movements_product_idx on stock_movements (product_id) include (quantity);
create index stock_movements_type_idx    on stock_movements (movement_type, occurred_at desc);
create unique index stock_movements_source_idx
  on stock_movements (source_table, source_id, product_id, movement_type)
  where source_table <> 'manual';                                     -- idempotent deduction

create index orders_delivery_idx on orders (delivery_at) where status not in ('closed','cancelled');
create index purchases_supplier_idx on purchases (supplier_id);
create index payroll_items_run_idx  on payroll_items (payroll_run_id);
create index audit_log_entity_idx   on audit_log (entity_table, entity_id, recorded_at desc);
create index audit_log_actor_idx    on audit_log (actor_id, recorded_at desc);  -- FR-9.6 filters
```

### 4.4 Search (FR-3.2)

Client search is by name or phone. On the server:

```sql
create extension if not exists pg_trgm;
create index clients_name_trgm_idx on clients using gin (name gin_trgm_ops);
create index clients_phone_idx     on clients (phone);
```

On device, search runs against local SQLite, so the server index matters only for the
admin/website surface. The device equivalent is in §9.3.

### 4.5 Partial-index convention

Most business queries end in `where deleted_at is null`. Where a table is expected to
accumulate soft-deleted rows, the index carries the same predicate so it stays small.

---

## 5. Row Level Security

### 5.1 Principles

1. **RLS is the enforcement layer, always** (PRD §3.1). The UI hides what a role cannot
   use; hiding is not a security mechanism. Every policy here must hold against a caller
   who has the anon key and a valid JWT and is issuing raw PostgREST calls.
2. **RLS is enabled and forced on every table.** `alter table X enable row level security;`
   plus `force row level security;` — without `force`, the table owner bypasses policies,
   which would let a `security definer` function leak the whole table.
3. **Default deny.** No policy means no access. Policies are added per role per operation.
4. **Every policy tests `is_active`.** This is what makes T4 work: deactivating a user
   revokes access on their next server contact even though their cached JWT still parses.

### 5.2 Role helper

```sql
create or replace function app.current_user_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from profiles p where p.id = auth.uid() and p.is_active
$$;
```

Named `current_user_role`, not `current_role`: `CURRENT_ROLE` is a reserved word in
Postgres and cannot be used as a function name without quoting.

`security definer` breaks the recursion that would otherwise occur when a policy on
`profiles` needs to read `profiles`. `set search_path` is mandatory — without it the
function is a privilege-escalation vector. It returns `null` for a deactivated user, and
since every policy compares against it, `null` denies everything.

Convenience predicates: `app.is_owner()`, `app.is_staff()` (`owner|manager`),
`app.can_see_finance()` (`owner|manager|accountant`).

### 5.3 Policy matrix

Derived from PRD §3.1. `own` = row is scoped to the caller. `—` = no policy, therefore denied.

| Table                                      | Op                | owner                                                       | manager | accountant                   | sales                                                                                               |
| ------------------------------------------ | ----------------- | ----------------------------------------------------------- | ------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `profiles`                                 | select            | all                                                         | all     | all                          | all (name/role only, via view)                                                                      |
|                                            | insert/update     | all                                                         | —       | —                            | —                                                                                                   |
|                                            | update role       | **only owner** (FR-1.3)                                     | —       | —                            | —                                                                                                   |
| `clients`                                  | select            | all                                                         | all     | all                          | `own` (`created_by = auth.uid()`, FR-3.4)                                                           |
|                                            | insert            | ✓                                                           | ✓       | ✓                            | ✓                                                                                                   |
|                                            | update            | all                                                         | all     | all                          | `own`                                                                                               |
|                                            | soft-delete       | ✓                                                           | ✓       | —                            | —                                                                                                   |
| `orders`                                   | select            | all                                                         | all     | all                          | `own` (`created_by` or `taken_by`)                                                                  |
|                                            | insert            | ✓                                                           | ✓       | —                            | ✓                                                                                                   |
|                                            | update            | all                                                         | all     | —                            | `own` **and** `status = 'draft'` (FR-4.5)                                                           |
|                                            | cancel            | ✓                                                           | ✓       | —                            | — (FR-4.2)                                                                                          |
|                                            | soft-delete       | ✓                                                           | ✓       | —                            | **never** (FR-4.5)                                                                                  |
| `order_items`                              | —                 | inherits the parent order's policy via an `exists` subquery |         |                              |                                                                                                     |
| `invoices`                                 | select            | all                                                         | all     | all                          | `own`                                                                                               |
|                                            | insert            | ✓                                                           | ✓       | ✓                            | ✓ (FR-5.x)                                                                                          |
|                                            | update            | ✓                                                           | ✓       | ✓                            | —                                                                                                   |
|                                            | void              | ✓                                                           | ✓       | —                            | —                                                                                                   |
| `payments`                                 | select            | all                                                         | all     | all                          | `own`                                                                                               |
|                                            | insert            | ✓                                                           | ✓       | ✓                            | ✓                                                                                                   |
|                                            | **update/delete** | **— for every role, no exceptions** (FR-5.5)                | —       | —                            | —                                                                                                   |
| `reversals`                                | select            | all                                                         | all     | all                          | —                                                                                                   |
|                                            | insert            | ✓                                                           | ✓       | —                            | — (FR-5.5)                                                                                          |
| `categories`                               | select            | all                                                         | all     | all                          | all                                                                                                 |
|                                            | write             | ✓                                                           | ✓       | —                            | —                                                                                                   |
| `products`                                 | select            | all                                                         | all     | all                          | all                                                                                                 |
|                                            | write             | ✓                                                           | ✓       | —                            | — (FR-3.1 matrix: accountant/sales view only)                                                       |
| `product_prices`                           | select            | all                                                         | all     | all                          | all                                                                                                 |
|                                            | write             | ✓                                                           | ✓       | —                            | —                                                                                                   |
| `stock_movements`                          | select            | all                                                         | all     | all                          | all                                                                                                 |
|                                            | insert            | ✓                                                           | ✓       | —                            | via trigger only (a sale writes movements as the order transitions; `sales` never inserts directly) |
|                                            | update/delete     | **— for every role**                                        | —       | —                            | —                                                                                                   |
| `suppliers`, `purchases`, `purchase_items` | select            | all                                                         | all     | all                          | **—** (FR-7.5)                                                                                      |
|                                            | write             | ✓                                                           | ✓       | —                            | —                                                                                                   |
| `supplier_payments`                        | select            | all                                                         | all     | all                          | —                                                                                                   |
|                                            | insert            | ✓                                                           | ✓       | ✓                            | —                                                                                                   |
|                                            | update/delete     | **— for every role**                                        | —       | —                            | —                                                                                                   |
| `employees`                                | select            | all                                                         | all     | all                          | — (FR-8.8)                                                                                          |
|                                            | write             | ✓                                                           | —       | ✓                            | —                                                                                                   |
| `advances`                                 | select            | all                                                         | all     | all                          | —                                                                                                   |
|                                            | insert            | ✓                                                           | ✓       | —                            | — (FR-8.3)                                                                                          |
|                                            | approve           | **only owner** (FR-8.3)                                     | —       | —                            | —                                                                                                   |
| `payroll_runs`                             | select            | all                                                         | all     | all                          | —                                                                                                   |
|                                            | insert/update     | ✓                                                           | —       | ✓ **and** `status = 'draft'` | — (FR-8.5)                                                                                          |
|                                            | approve           | **only owner** (FR-8.5)                                     | —       | —                            | —                                                                                                   |
| `payroll_items`                            | select            | all                                                         | all     | all                          | —                                                                                                   |
|                                            | write             | ✓                                                           | —       | ✓ while the run is `draft`   | —                                                                                                   |
| `company_settings`                         | select            | all                                                         | all     | all                          | all (documents need it)                                                                             |
|                                            | update            | ✓                                                           | —       | —                            | —                                                                                                   |
| `tax_config`, `statutory_rates`            | select            | all                                                         | all     | all                          | all                                                                                                 |
|                                            | write             | **only owner** (FR-9.3)                                     | —       | —                            | —                                                                                                   |
| `audit_log`                                | select            | all                                                         | all     | **—**                        | **—** (PRD §3.1)                                                                                    |
|                                            | insert            | **— for every role**; written by trigger only (§7)          | —       | —                            | —                                                                                                   |
|                                            | update/delete     | **— for every role, including owner**                       | —       | —                            | —                                                                                                   |
| `sync_devices`                             | select            | all                                                         | all     | —                            | `own`                                                                                               |
|                                            | upsert            | `own`                                                       | `own`   | `own`                        | `own`                                                                                               |
| `website_contact_messages`                 | insert            | `anon` **only**                                             |         |                              |                                                                                                     |
|                                            | select            | ✓                                                           | ✓       | —                            | —                                                                                                   |

### 5.4 Policies that are not a simple role test

**Owner-only role change (FR-1.3).** A `manager` may not escalate themselves. The `update`
policy on `profiles` permits non-owners nothing, and a `BEFORE UPDATE` trigger additionally
rejects any change to `role` or `is_active` where `app.current_role() <> 'owner'` — belt
and braces, because a future permissive policy would otherwise silently open it.

**Sales editing only their own drafts (FR-4.5).** Needs both `USING` (which rows are
visible to update) and `WITH CHECK` (what the row may become). Without `WITH CHECK`, a
`sales` user could update their draft and set `created_by` to someone else, or move it out
of `draft` and then keep editing it.

```sql
create policy orders_update_sales on orders for update to authenticated
  using       (app.current_role() = 'sales' and created_by = auth.uid() and status = 'draft')
  with check  (app.current_role() = 'sales' and created_by = auth.uid() and status = 'draft');
```

**Append-only tables.** `payments`, `reversals`, `stock_movements`, `supplier_payments` and
`audit_log` have **no** UPDATE or DELETE policy at all, plus a trigger that raises on either.
The trigger is not redundant: `force row level security` covers the table owner, but a
future `security definer` helper would not be covered by policies alone.

**Sales dashboard scoping (FR-2.8).** Not a separate mechanism — the reporting views are
`security_invoker`, so a `sales` user aggregating `orders` sees only their own rows and the
dashboard narrows itself.

---

## 6. Sync design (PRD §6)

### 6.1 Shape

Every device holds a full local SQLite copy (NFR-S1). Reads and writes hit SQLite only;
**no UI path ever awaits the network** (NFR-S1). A sync cycle is two ordered phases:

```
push (outbox → Supabase)   then   pull (Supabase → SQLite, per-table cursor)
```

Push precedes pull, always. Reversing them would let a pull overwrite a local edit that has
not yet been sent, destroying it silently.

Triggers (NFR-S3): app launch · debounced 2 s after any local write · every 5 minutes while
open · on connectivity regained · manual "Sync now" (FR-9.4). Sync runs only while the app
is open (NFR-S7); there is no background service on either platform.

A cycle holds a local advisory lock so overlapping triggers cannot interleave.

### 6.2 Pull: cursors and keyset paging

Cursor per table, stored in the device-local `sync_state` (§9.2):

```sql
select * from <table>
where  (updated_at, id) > (:cursor_updated_at, :cursor_id)
order by updated_at, id
limit  500;
```

Two details that are easy to get wrong and expensive to discover later:

- **The cursor is a `(updated_at, id)` pair, not a bare timestamp.** With `where updated_at >
:cursor`, any rows sharing the boundary timestamp beyond the page limit are skipped
  forever; with `>=`, the last page repeats indefinitely. Postgres row-value comparison
  gives a total order and neither failure.
- **The cursor advances only after the page is committed to SQLite**, inside the same
  transaction. A crash mid-page therefore re-fetches that page rather than losing it.

Soft-deleted rows are pulled like any other change (NFR-S5) — `deleted_at` arriving is how
a device learns of a deletion. Local reads filter `deleted_at is null`.

Initial sync on a fresh install pages through every table from cursor zero (T5).

### 6.3 `updated_at` is server-authoritative

```sql
create trigger set_updated_at before insert or update on <table>
for each row execute function app.touch_updated_at();   -- new.updated_at := now()
```

The device's own clock is never written to `updated_at`, and any client-supplied value is
overwritten. This matters more than it looks: cursors are compared against this column, and
an Android phone with a clock ten minutes fast would otherwise write rows that every other
device's cursor has already passed, making them permanently invisible. Device time is still
captured, but in separate columns that mean "when the thing happened" — `paid_at`,
`occurred_at`, `audit_log.occurred_at` — never in sync bookkeeping.

### 6.4 Push: the outbox and idempotency

The outbox (§9.2) is an ordered local journal of intents. Entries are pushed in `seq`
order, batched by table, and deleted on success.

Idempotency rests on **client-generated UUID primary keys**. Every push is an upsert keyed
on `id`:

```sql
insert into orders (...) values (...)
on conflict (id) do update set ... where orders.updated_at < excluded.updated_at;
```

So the dangerous case — the server commits, the response is lost to a dropped connection,
the device retries — resolves to a no-op rather than a duplicate. This is what T6 tests:
200 orders and payments replayed produce 200 rows, not 400.

For append-only tables the upsert degrades to `on conflict (id) do nothing`, which is the
strongest possible guarantee: a payment can be pushed any number of times and exists once.

Failure handling: `attempts` increments and `last_error` is recorded; retries are
exponentially backed off. An entry that fails on a **4xx** (a constraint or RLS rejection —
i.e. the write will never succeed) is moved to `outbox_dead` and surfaced to the user rather
than blocking the queue behind it forever. A **5xx** or network failure stays queued.

The outbox depth is what FR-9.4's indicator reports: `synced` / `N pending` / `offline`.

### 6.5 Conflict resolution (NFR-S4, T2)

| Class              | Tables                                                                                       | Rule                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Append-only**    | `payments`, `reversals`, `stock_movements`, `supplier_payments`, `audit_log`                 | **Cannot conflict.** Distinct UUIDs, insert-only, and every derived figure is a sum. Two devices recording payments offline against one invoice both survive and the balance is correct (T3). |
| **Shared mutable** | `clients`, `orders`, `invoices`, `products`, `suppliers`, `purchases`, `employees`, settings | **Server wins** (NFR-S4). Last push to arrive is the server's state; the subsequent pull overwrites every device with it.                                                                     |
| **Device-local**   | `sync_state`, `outbox`                                                                       | Never synced.                                                                                                                                                                                 |

"Server wins" is resolved at whole-row granularity, not per field. Field-level merging was
rejected: it produces rows that never existed on any device, and with fewer than 10 users
editing largely disjoint records, the failure it avoids is rarer than the confusion it
creates.

T2 is therefore deterministic in a specific and limited sense: the device whose push
arrives **last** wins, and every device converges on that result. It is not "most recent
edit wins" — a device offline for a day that syncs at 17:00 overwrites an edit made at
16:00 by a device that was online. This is the PRD's stated rule, it is predictable, and
the audit log (§7) preserves the overwritten values so nothing is unrecoverable.

The pull loop must not clobber unpushed local work: a pulled row is applied unless the
local row still has a pending outbox entry, in which case it is applied _after_ that entry
pushes. Since push precedes pull in every cycle, this window is narrow but real — a write
landing mid-cycle.

### 6.6 Business rules that cannot live on the client

Any invariant spanning rows a device cannot see must be a server trigger, because an
offline device is by definition missing other devices' data. Concretely:

| Rule                                         | Requirement    | Why server-side                                                 |
| -------------------------------------------- | -------------- | --------------------------------------------------------------- |
| Invoice numbering                            | FR-5.1         | Needs a global sequence — §8.                                   |
| Blocking client delete with unpaid invoices  | FR-3.5         | Invoices may live on another device.                            |
| Reversal not exceeding its payment           | FR-5.5         | Other reversals may be unsynced.                                |
| Stock movements on order/purchase transition | FR-6.6, FR-7.6 | Must fire exactly once, whichever device causes the transition. |
| Audit entries                                | PRD §3         | A client could otherwise omit them — §7.                        |

The client may compute these optimistically for display, but the server's result is
authoritative and overwrites it on the next pull.

### 6.7 Test scenarios → mechanism

| Test                          | Satisfied by                                                               |
| ----------------------------- | -------------------------------------------------------------------------- |
| T1 offline order syncs        | §6.1 outbox, §6.4 upsert                                                   |
| T2 same record, two devices   | §6.5 server wins, whole-row                                                |
| T3 double offline payment     | §6.5 append-only, §3.1 balance as a sum                                    |
| T4 deactivation while offline | §5.1 every policy tests `is_active`, plus refresh-token revocation (§2.1)  |
| T5 fresh install then offline | §6.2 initial full page-through, cached session (FR-1.2)                    |
| T6 200 records, idempotent    | §6.4 client UUID keys, `on conflict do nothing`, §2.11 unique source index |

---

## 7. Audit log (PRD §3, FR-9.6)

### 7.1 Schema

| Column           | Type                                 | Notes                                                                                                                                             |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `uuid` PK                            |                                                                                                                                                   |
| `actor_id`       | `uuid` `references profiles(id)`     | Null only for system actions.                                                                                                                     |
| `actor_role`     | `text` not null                      | **Denormalised deliberately** — the role _at the time of the action_. Reading it from `profiles` later would misreport history after a promotion. |
| `action`         | `text` not null                      | `payment.record`, `payroll.approve`, `client.delete`, `product.price_change`, `profile.role_change`, `stock.adjust`, …                            |
| `entity_table`   | `text` not null                      |                                                                                                                                                   |
| `entity_id`      | `uuid` not null                      |                                                                                                                                                   |
| `before`         | `jsonb`                              | Null on insert.                                                                                                                                   |
| `after`          | `jsonb`                              | Null on delete.                                                                                                                                   |
| `changed_fields` | `text[]`                             | Computed from the diff; makes FR-9.6 filtering cheap and the viewer readable.                                                                     |
| `reason`         | `text`                               | Carried from the action where one is required.                                                                                                    |
| `device_id`      | `uuid`                               | From `sync_devices`.                                                                                                                              |
| `occurred_at`    | `timestamptz` not null               | **Device time** — when the user did it, possibly offline.                                                                                         |
| `recorded_at`    | `timestamptz` not null default now() | **Server time** — when it reached Postgres.                                                                                                       |

Both timestamps are kept. Their gap is exactly the offline window, which is the first thing
anyone investigating a discrepancy needs to know.

### 7.2 Written by trigger, never by the client

```sql
create trigger audit_payments after insert on payments
for each row execute function app.write_audit('payment.record');
```

Attached to the tables PRD §3 names: payments, payroll approval, deletes, price changes,
role changes, stock adjustments.

The client never inserts into `audit_log` and has no policy permitting it. This is the
whole point — an audit trail a client can choose not to write is not an audit trail. Because
the trigger fires when the row _reaches the server_, an action taken offline is still
audited, at push time, with `occurred_at` preserved from the payload.

Consequence: `audit_log` is **pull-only** on devices. It never appears in the outbox.

### 7.3 Immutability

No INSERT, UPDATE or DELETE policy exists for any role, including `owner`. A trigger raises
on UPDATE and DELETE, covering the table-owner path that `force row level security` alone
would not. Retention is unbounded in v1; the nightly backup (PRD §7) carries it.

### 7.4 Visibility

`owner` full, `manager` view, `accountant` and `sales` none (PRD §3.1). The FR-9.6 viewer
filters by user, action type and date range — served by the two indexes in §4.3.

---

## 8. Invoice numbering (FR-5.1)

**Requirement:** `INV-YYYY-NNNN`, sequential, gap-free, never reused. **Constraint:** invoices
are created on devices that may be offline for hours.

### 8.1 The tension, stated plainly

These cannot both hold on the device. A device that cannot reach the server cannot know
which numbers other devices have taken, so any locally assigned number is either a guess
(risking collision) or reserved from a pre-allocated block (guaranteeing gaps when a block
is partly used). Gap-free numbering is inherently a serialisation point.

### 8.2 Resolution: separate identity from numbering

|                           | Assigned       | When                         | Purpose                               |
| ------------------------- | -------------- | ---------------------------- | ------------------------------------- |
| `invoices.id`             | Device, `uuid` | Immediately, offline         | Identity. Everything references this. |
| `invoices.invoice_number` | **Server**     | On first arrival at Postgres | Human/legal reference.                |

An invoice is created offline in full and is immediately usable. `invoice_number` stays
`NULL` until the row syncs. The UI shows "Number assigned on sync" for an unnumbered
invoice, and **the invoice PDF (FR-5.2) cannot be issued until it has a number** — which is
correct behaviour, not a limitation: a numbered document handed to a client must have a
number no other document will ever carry.

### 8.3 Gap-free allocation

A Postgres `SEQUENCE` is **not** usable here. Sequences are explicitly non-transactional:
a rolled-back insert burns its value, and `CACHE` burns more. Both produce gaps.

A counter table with row-level locking is transactional and therefore gap-free:

```sql
create table app.document_counters (
  kind       text    not null check (kind in ('invoice', 'order', 'purchase')),
  year       integer not null,
  next_value integer not null default 1,
  primary key (kind, year)
);

create or replace function app.allocate_document_number(p_kind text, p_prefix text, p_year integer)
returns text language plpgsql as $$
declare v_seq integer;
begin
  insert into app.document_counters (kind, year, next_value) values (p_kind, p_year, 2)
  on conflict (kind, year) do update set next_value = app.document_counters.next_value + 1
  returning next_value - 1 into v_seq;

  return format('%s-%s-%s', p_prefix, p_year, lpad(v_seq::text, 4, '0'));
end $$;
```

One counter table keyed by `(kind, year)` rather than three tables, so `INV-`, `ORD-`
and `PUR-` share one implementation and no dynamic SQL is needed. Only invoices carry
the gap-free obligation; the other two get it for free.

Why this is correct:

- The `INSERT … ON CONFLICT DO UPDATE` takes a **row lock** on that year's counter.
  Concurrent transactions serialise behind it; each gets a distinct consecutive value.
- The allocation is **in the same transaction as the invoice insert**. If that transaction
  rolls back, the counter increment rolls back with it. No gap. This is precisely the
  property a sequence gives up in exchange for concurrency.
- The single statement also handles the first invoice of a new year without a race between
  two devices both finding no row and both inserting.

Throughput is bounded by that lock — one invoice at a time, per year. For a business
issuing tens of invoices a day, this is irrelevant; correctness is worth far more than the
concurrency being given up.

### 8.4 Trigger and idempotency

```sql
create trigger invoices_assign_number before insert on invoices
for each row when (new.invoice_number is null)
execute function app.assign_invoice_number();   -- uses extract(year from new.issue_date)
```

Fires **only on INSERT and only when the number is null**, so:

- A re-pushed invoice hits `on conflict (id) do update` (§6.4), which is an UPDATE — the
  trigger does not fire, and the number is not reallocated. A retried sync cannot burn
  numbers or renumber an issued invoice.
- A number, once set, is never changed. The update path rejects any attempt to modify it.

### 8.5 Year attribution and voids

The year comes from `issue_date`, not from `now()` at sync time. An invoice issued offline
on 31 December that syncs on 2 January belongs to the earlier year's sequence — which is
what the client's accountant will expect, and keeps each year's run contiguous.

Edge case, documented and accepted: this can produce an out-of-order arrival, where an
invoice issued on 31 December is numbered after one issued on 30 December that synced
first. Numbers stay gap-free and unique; they are not guaranteed to be monotonic in
`issue_date`. Preventing that would require blocking numbering until every device has
reported, which is impossible offline.

**Voided invoices keep their number** (§2.5). This is how "gap-free" and "never reused"
coexist: nothing is deleted from the sequence, and nothing is recycled. `PUR-` and `ORD-`
numbers use the same function against their own counter tables, but carry no gap-free
obligation.

---

## 9. Device-local SQLite schema

### 9.1 Type mapping

SQLite has no `uuid`, `timestamptz`, `jsonb`, `numeric` or `boolean`. The mapping is fixed
and applied everywhere, so that one row round-trips through both stores unchanged:

| Postgres         | SQLite    | Encoding                                                                                                                                                          |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid`           | `TEXT`    | Lowercase canonical hyphenated form. Case matters for joins — normalise on write.                                                                                 |
| `timestamptz`    | `TEXT`    | ISO-8601 **UTC**, `YYYY-MM-DDTHH:MM:SS.sssZ`. Lexicographic order matches chronological order, which is what makes the §6.2 cursor comparison work in SQLite too. |
| `date`           | `TEXT`    | `YYYY-MM-DD`.                                                                                                                                                     |
| `bigint` (cents) | `INTEGER` | 64-bit; no precision loss. **Never** read into a JS `number` above 2^53 — money stays in `bigint`/string at the boundary.                                         |
| `numeric(12,3)`  | `INTEGER` | Stored as **thousandths**. SQLite's `REAL` is binary floating point and would drift on repeated summation, which is exactly what `product_stock` does.            |
| `boolean`        | `INTEGER` | 0 / 1.                                                                                                                                                            |
| `jsonb`          | `TEXT`    | Serialised JSON; parsed at the repository layer.                                                                                                                  |
| `text[]`         | `TEXT`    | JSON array.                                                                                                                                                       |

Local tables mirror the server's columns and add nothing except where §9.2 says otherwise.
Local reads always filter `deleted_at IS NULL`.

### 9.2 Local-only tables (never synced)

```sql
create table outbox (
  seq            integer primary key autoincrement,  -- push order
  entity_table   text    not null,
  entity_id      text    not null,
  op             text    not null check (op in ('insert','update','delete')),
  payload        text    not null,                   -- JSON of the full row
  attempts       integer not null default 0,
  next_attempt_at text,                              -- exponential backoff
  last_error     text,
  created_at     text    not null
);
create index outbox_entity_idx on outbox (entity_table, entity_id);

create table outbox_dead (            -- permanently rejected: constraint or RLS failure
  seq integer primary key, entity_table text, entity_id text,
  op text, payload text, error text, failed_at text
);

create table sync_state (             -- one row per synced table: the pull cursor
  table_name        text primary key,
  cursor_updated_at text,
  cursor_id         text,
  last_pulled_at    text
);

create table local_meta (             -- device id, schema version, cached session/role
  key text primary key, value text
);
```

`outbox.entity_id` is indexed because §6.5's pull loop asks "does this row have a pending
local write?" for every incoming row.

Collapsing rule: an insert followed by updates to the same still-unpushed row is collapsed
to a single insert carrying the latest payload. This keeps the queue proportional to
changed _records_, not keystrokes, and is what makes the NFR "a day's work syncs in under
10 s on 3G" achievable.

### 9.3 Local indexes and search

The sync indexes of §4.1 are not needed locally (cursors query the server). Local indexes
serve the list screens' 500 ms budget (PRD §7): the foreign keys of §4.3, plus
`orders (delivery_at)`, `invoices (due_date)`, `stock_movements (product_id)`.

Client search (FR-3.2) uses an FTS5 virtual table over `clients(name, phone)`, kept current
by triggers. `LIKE '%term%'` cannot use an index and degrades visibly at a few thousand rows.

### 9.4 Migrations

Registered with `tauri-plugin-sql` and applied in order at startup. Versioned and
**forward-only** — a migration must never drop or rewrite a column holding unpushed outbox
data, because an app update may land while the queue is non-empty (PRD §7: "updates never
destroy unsynced local data"). The release checklist verifies an update with a non-empty
outbox.

Server migrations and device migrations are separate sequences; a server column is added
before the device build that uses it ships, so an older device keeps syncing.

---

## 10. Open questions blocking schema decisions

Each carries a PRD `[FILL IN]`. The structure above accommodates either answer; none is
guessed. Answer before building the named module.

| #   | PRD           | Question                                                 | Structure already in place                                                                                  | Still needed                                                                                                                  |
| --- | ------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | FR-6.6, §12.4 | Stock deducted at order confirmation or delivery?        | `company_settings.stock_deduction_point`; `orders.confirmed_at` / `delivered_at`; idempotent movement index | Which value to seed, before the inventory module                                                                              |
| 2   | FR-6.3, §12.3 | Wholesale vs retail pricing model?                       | `product_prices (product_id, client_type)` override table                                                   | Whether it is used at all, and on what axis                                                                                   |
| 3   | FR-7.3        | Does receiving a purchase update the product cost price? | `company_settings.update_cost_on_receipt`; movements always store `unit_cost_cents`                         | The toggle's value; whether costing is latest or weighted-average                                                             |
| 4   | §12.3         | VAT registered? Rate? Which categories?                  | `tax_config`, `categories.is_vatable`, `invoices.vat_rate_bp` snapshot                                      | Registration status before any invoice is issued                                                                              |
| 5   | FR-8.9, §12.5 | Sales commissions?                                       | _Nothing._ No table is proposed                                                                             | If commissions exist, this is a new module: `commission_rules` + `commission_entries`. Do not bolt it onto payroll deductions |
| 6   | FR-5.2, §12.6 | M-Pesa paybill/till and bank details                     | `company_settings` columns; snapshotted per invoice                                                         | The actual values before go-live                                                                                              |
| 7   | FR-8.8        | Extent of accountant payroll visibility                  | §5.3 grants select on runs/items and write while `draft`                                                    | Confirm the accountant may see net pay for every employee                                                                     |
| 8   | §12.7         | eTIMS obligation                                         | `kra_pin` on invoices and clients                                                                           | Confirm v2; no schema change needed to defer                                                                                  |
| 9   | §9            | ODPC registration                                        | `employees` role-gated; audit on payroll                                                                    | Registration status, privacy policy copy                                                                                      |

Question 5 is the only one that would add tables. The rest are values or toggles.

---

## 11. Open design risks

Recorded so they are decided deliberately rather than discovered.

1. **`stock_movements` is the only unbounded hot aggregate.** §3.2 has the rollup escape
   hatch. Revisit if a device's movement count passes ~50,000.
2. **Whole-row "server wins" can discard a field a user did not touch.** Two people editing
   different fields of one client on the same day: the later push wins the whole row. The
   audit log preserves the lost values. Accepted per NFR-S4; revisit only with evidence.
3. **Invoice numbering serialises on one row per year.** Correct but not scalable. It will
   not matter at this volume.
4. **`payroll_items` stores computed figures.** If a rate is corrected retroactively, an
   approved run does not change — by design. Correcting one means a new run, not an edit.
5. **Numbers are gap-free and unique but not monotonic in `issue_date`** (§8.5). Flag for
   the client's accountant before go-live.
6. **No background sync** (NFR-S7). A device that is never opened never syncs; the owner
   sees staleness via `sync_devices.last_seen_at`.
