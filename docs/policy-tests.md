# Policy tests — Rasko Sweet Scent

Version: 1.0 · Companion to `docs/architecture.md` §5 and the PRD §3.1 matrix.

Every RLS policy in the schema, with a manual check you can run in the Supabase
dashboard. **61 policies across 25 tables.**

PRD §3.1 is explicit that the UI hiding a module is never the security mechanism —
the server is. These checks are how you prove the server actually refuses. Run the
whole file against staging before go-live (PRD §11: "each role verified by attempting
forbidden actions"), and re-run §12 after any migration that touches policies.

---

## 0. Applying the schema

```bash
supabase init                 # creates supabase/config.toml; keep the existing seed.sql
supabase start                # local stack (Docker)
supabase db reset             # apply all migrations, then run seed.sql
```

Against a hosted project:

```bash
supabase link --project-ref <PROJECT_REF>
supabase db push                                  # migrations only
psql "$DATABASE_URL" -f supabase/seed.sql         # staging only, never production
```

`supabase db reset` is destructive — it drops and rebuilds the local database. Never
point it at production.

---

## 1. The test harness

### 1.1 Where

Supabase dashboard → **SQL Editor** → New query. The editor runs as a privileged
role that **bypasses RLS**, so a query typed straight in proves nothing. Every check
below therefore impersonates a role first.

### 1.2 How to impersonate a role

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"<USER-UUID>"}', true);
  set local role authenticated;

  -- ... the check goes here ...

rollback;   -- ALWAYS rollback. These tests write.
```

Three things make this work, and all three matter:

- `set_config(..., true)` sets the claim **transaction-locally**, so it cannot leak
  into your next query.
- `set local role authenticated` drops out of the privileged role. Without it RLS is
  bypassed and every check below passes vacuously.
- `rollback` at the end. Several checks insert or update; none should persist.

To test the public website surface, use `set local role anon` and set no claims.

### 1.3 Seeded users

`supabase/seed.sql` creates these with fixed ids so the checks are copy-pasteable.

| Role       | UUID                                   | Name             |
| ---------- | -------------------------------------- | ---------------- |
| owner      | `11111111-1111-4111-8111-111111111111` | Alice Tonui      |
| manager    | `22222222-2222-4222-8222-222222222222` | Brian Mwangi     |
| accountant | `33333333-3333-4333-8333-333333333333` | Caroline Achieng |
| sales      | `44444444-4444-4444-8444-444444444444` | Daniel Kiplagat  |

Other fixed ids used below:

| What                                          | UUID                                   |
| --------------------------------------------- | -------------------------------------- |
| Client owned by **manager** (Menengai Events) | `c0000000-0000-4000-8000-000000000002` |
| Client owned by **sales** (Mercy Chebet)      | `c0000000-0000-4000-8000-000000000006` |
| Order, status `confirmed`                     | `70000000-0000-4000-8000-000000000002` |
| Order, status `draft`, created by sales       | `70000000-0000-4000-8000-000000000005` |
| Invoice, issued, partially paid               | `80000000-0000-4000-8000-000000000002` |
| Payment (KES 20,000)                          | `90000000-0000-4000-8000-000000000001` |
| Payroll run, status `draft`                   | `b0000000-0000-4000-8000-000000000001` |

### 1.4 Reading the result

Each check states the expected outcome. Three shapes appear:

- **`ERROR: ...`** — the policy or a guard trigger refused. This is a pass when the
  check says so.
- **`UPDATE 0` / `0 rows`** — RLS filtered the row out. A silent pass; note that a
  refused UPDATE reports success with zero rows, so **always read the count**.
- **A row count** — compare against the expected number.

---

## 2. The fastest whole-matrix check

One query per role. Run each block and compare against the table below; if all four
match, the visibility half of PRD §3.1 holds.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  select (select count(*) from clients)      as clients,
         (select count(*) from suppliers)    as suppliers,
         (select count(*) from employees)    as employees,
         (select count(*) from payroll_runs) as payroll,
         (select count(*) from audit_log)    as audit;
rollback;
```

Expected, against the seed data:

| Role       | clients | suppliers | employees | payroll | audit |
| ---------- | ------- | --------- | --------- | ------- | ----- |
| owner      | 6       | 3         | 4         | 1       | > 0   |
| manager    | 6       | 3         | 4         | 1       | > 0   |
| accountant | 6       | 3         | 4         | 1       | **0** |
| sales      | **2**   | **0**     | **0**     | **0**   | **0** |

Sales seeing 2 of 6 clients is FR-3.4 working: only the two rows it created.

---

## 3. profiles — PRD 3.1 "Users & settings"

That matrix row governs _managing_ users. Reading colleague names is a separate need
(`orders.taken_by`, `payments.received_by` pickers), so SELECT is open to all active
staff while writes are owner-only.

| Policy                  | Command | Rule                                |
| ----------------------- | ------- | ----------------------------------- |
| `profiles_select_staff` | SELECT  | any active staff member             |
| `profiles_insert_owner` | INSERT  | owner only                          |
| `profiles_update_owner` | UPDATE  | owner only                          |
| `profiles_update_self`  | UPDATE  | your own row (contact details only) |

**3.1 — Sales can read the staff list.** Expect 4 rows.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  select count(*) from profiles;
rollback;
```

**3.2 — A manager cannot promote themselves (FR-1.3).** Expect
`ERROR: Only the owner may change a role or activation status`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
  set local role authenticated;
  update profiles set role = 'owner' where id = '22222222-2222-4222-8222-222222222222';
rollback;
```

**3.3 — Sales cannot deactivate anyone.** Expect `UPDATE 0` (no matching policy).

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  update profiles set is_active = false, deactivated_at = now()
   where id = '33333333-3333-4333-8333-333333333333';
rollback;
```

**3.4 — Anyone may edit their own phone number.** Expect `UPDATE 1`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  update profiles set phone = '+254712999999' where id = '33333333-3333-4333-8333-333333333333';
rollback;
```

**3.5 — T4: a deactivated user loses everything.** Expect all counts `0`.

```sql
begin;
  update profiles set is_active = false, deactivated_at = now()
   where id = '44444444-4444-4444-8444-444444444444';

  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  select (select count(*) from clients)  as clients,
         (select count(*) from orders)   as orders,
         (select count(*) from invoices) as invoices,
         (select count(*) from products) as products;
rollback;
```

This is the whole of T4. The device keeps a valid cached JWT, and it buys nothing:
`app.current_user_role()` returns NULL for an inactive profile, every policy compares
against it, and NULL comparisons are never true. In production, also revoke the
refresh token via the Admin API so the JWT cannot be renewed.

---

## 4. clients — "All / All / All / Own clients only"

| Policy           | Command | Rule                                                        |
| ---------------- | ------- | ----------------------------------------------------------- |
| `clients_select` | SELECT  | finance roles see all; sales sees `created_by = auth.uid()` |
| `clients_insert` | INSERT  | any active staff                                            |
| `clients_update` | UPDATE  | same scoping as select                                      |

**4.1 — Sales sees only its own (FR-3.4).** Expect 2 rows, both created by sales.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  select name, created_by from clients order by name;
rollback;
```

**4.2 — Sales cannot edit a client it did not create.** Expect `UPDATE 0`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  update clients set notes = 'should not apply'
   where id = 'c0000000-0000-4000-8000-000000000002';
rollback;
```

**4.3 — FR-3.5: a client who owes money cannot be deleted.** Expect
`ERROR: Cannot delete client "Menengai Events & Planning": 12750000 cents still outstanding`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
  set local role authenticated;
  update clients set deleted_at = now() where id = 'c0000000-0000-4000-8000-000000000002';
rollback;
```

**4.4 — Sales cannot soft-delete even its own client.** Expect
`ERROR: Role sales may not delete from clients`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  update clients set deleted_at = now() where id = 'c0000000-0000-4000-8000-000000000006';
rollback;
```

---

## 5. orders and order_items — "All / All / View all / Create, no delete"

| Policy                | Command | Rule                                                   |
| --------------------- | ------- | ------------------------------------------------------ |
| `orders_select`       | SELECT  | finance roles all; sales `created_by` or `taken_by`    |
| `orders_insert`       | INSERT  | owner, manager, sales — **not** accountant (view only) |
| `orders_update_staff` | UPDATE  | owner, manager                                         |
| `orders_update_sales` | UPDATE  | sales, own row, **and status = draft**                 |
| `order_items_*`       | all     | inherits the parent order                              |

**5.1 — Accountant can read every order but create none.** Expect 5 rows, then
`ERROR: new row violates row-level security policy`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  select count(*) from orders;
  insert into orders (client_id, taken_by, created_by)
  values ('c0000000-0000-4000-8000-000000000004',
          '33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333');
rollback;
```

**5.2 — FR-4.5: sales edits only its own drafts.** Expect `UPDATE 0` then `UPDATE 1`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  update orders set notes = 'confirmed order' where id = '70000000-0000-4000-8000-000000000002';
  update orders set notes = 'own draft'       where id = '70000000-0000-4000-8000-000000000005';
rollback;
```

The first is the important one. The `WITH CHECK` half of `orders_update_sales` is why
a sales user also cannot reassign `created_by` or push a row out of `draft` and keep
editing it.

**5.3 — FR-4.2: only manager or owner may cancel.** Expect
`ERROR: Only a manager or the owner may cancel an order`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  update orders set status = 'cancelled', cancelled_at = now(),
                    cancellation_reason = 'test'
   where id = '70000000-0000-4000-8000-000000000005';
rollback;
```

**5.4 — Sales cannot delete an order, ever (FR-4.5).** Expect
`ERROR: Role sales may not delete from orders`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  update orders set deleted_at = now() where id = '70000000-0000-4000-8000-000000000005';
rollback;
```

---

## 6. invoices — "All / All / Create-edit / Create invoice, record payment"

| Policy            | Command | Rule                                       |
| ----------------- | ------- | ------------------------------------------ |
| `invoices_select` | SELECT  | finance roles all; sales own               |
| `invoices_insert` | INSERT  | any active staff, sales included           |
| `invoices_update` | UPDATE  | owner, manager, accountant — **not** sales |

**6.1 — Sales may create an invoice but not edit one.** Expect `INSERT 0 1` then `UPDATE 0`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  insert into invoices (client_id, status, issue_date, due_date, subtotal_cents, total_cents, created_by)
  values ('c0000000-0000-4000-8000-000000000006','draft', current_date, current_date,
          100000, 100000, '44444444-4444-4444-8444-444444444444');
  update invoices set total_cents = 1 where id = '80000000-0000-4000-8000-000000000002';
rollback;
```

**6.2 — Only manager or owner may void.** Expect
`ERROR: Only a manager or the owner may void an invoice`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  update invoices set status = 'voided', voided_at = now(), void_reason = 'test'
   where id = '80000000-0000-4000-8000-000000000002';
rollback;
```

**6.3 — FR-5.1: an invoice number can never be changed.** Expect
`ERROR: Invoice number INV-2026-0002 cannot be changed or reused`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
  set local role authenticated;
  update invoices set invoice_number = 'INV-2026-9999'
   where id = '80000000-0000-4000-8000-000000000002';
rollback;
```

**6.4 — Numbering is gap-free.** Expect a contiguous run with no holes.

```sql
select invoice_number, status from invoices
 where invoice_number is not null order by invoice_number;
select * from app.document_counters;
```

---

## 7. payments and reversals — append-only (FR-5.5)

| Policy             | Command | Rule                              |
| ------------------ | ------- | --------------------------------- |
| `payments_select`  | SELECT  | finance roles all; sales own      |
| `payments_insert`  | INSERT  | any active staff                  |
| **(none)**         | UPDATE  | **no policy exists for any role** |
| **(none)**         | DELETE  | **no policy exists for any role** |
| `reversals_select` | SELECT  | owner, manager, accountant        |
| `reversals_insert` | INSERT  | owner, manager only               |

**7.1 — Even the owner cannot alter a payment.** Both expect
`ERROR: permission denied for table payments`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
  set local role authenticated;
  update payments set amount_cents = 1 where id = '90000000-0000-4000-8000-000000000001';
rollback;

begin;
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
  set local role authenticated;
  delete from payments where id = '90000000-0000-4000-8000-000000000001';
rollback;
```

The error says _permission denied_, not _row-level security_, because `authenticated`
is never granted UPDATE or DELETE on this table at all. That is deliberate belt and
braces: the rule holds even if someone later adds a policy by mistake. The
`payments_append_only` trigger is the third layer, covering the table owner.

**7.2 — Sales cannot reverse a payment (FR-5.5).** Expect
`ERROR: new row violates row-level security policy for table "reversals"`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  insert into reversals (payment_id, amount_cents, reason)
  values ('90000000-0000-4000-8000-000000000001', 1000, 'test');
rollback;
```

**7.3 — A reversal cannot exceed its payment.** Expect
`ERROR: Reversals against payment ... would total 99999999 cents, exceeding the payment of 2000000 cents`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
  set local role authenticated;
  insert into reversals (payment_id, amount_cents, reason)
  values ('90000000-0000-4000-8000-000000000001', 99999999, 'too big');
rollback;
```

**7.4 — T3: balance is a sum, so concurrent offline payments cannot be lost.**

```sql
select invoice_number, total_cents, paid_cents, reversed_cents, balance_cents
from invoice_balances b join invoices i on i.id = b.invoice_id
where i.id = '80000000-0000-4000-8000-000000000002';
```

The seed records a duplicated cash payment and its reversal. Expect
`paid_cents = 2150000`, `reversed_cents = 150000`, `balance_cents = 4850000`. The
duplicate is visibly corrected rather than erased — which is the point of FR-5.5.

---

## 8. products, categories, product_prices, stock_movements — "All / All / View / View"

| Policy                                                          | Command         | Rule             |
| --------------------------------------------------------------- | --------------- | ---------------- |
| `products_select`, `categories_select`, `product_prices_select` | SELECT          | any active staff |
| `products_write`, `categories_write`, `product_prices_write`    | ALL             | owner, manager   |
| `stock_movements_select`                                        | SELECT          | any active staff |
| `stock_movements_insert`                                        | INSERT          | owner, manager   |
| **(none)**                                                      | UPDATE / DELETE | **append-only**  |

**8.1 — Sales and accountant can read the catalogue but not change a price.** Expect
6 rows then `UPDATE 0`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  select count(*) from products;
  update products set selling_price_cents = 1 where sku = 'RSS-ROS-001';
rollback;
```

**8.2 — Sales cannot write a stock movement directly.** Expect
`ERROR: new row violates row-level security policy`. Sales moves stock only through
the order lifecycle, via a SECURITY DEFINER trigger.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  insert into stock_movements (product_id, movement_type, quantity, reason)
  values ('40000000-0000-4000-8000-000000000001','adjustment', 100, 'test');
rollback;
```

**8.3 — A movement can never be edited or deleted.** Expect
`ERROR: permission denied for table stock_movements`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
  set local role authenticated;
  update stock_movements set quantity = 0
   where id = '63000000-0000-4000-8000-000000000001';
rollback;
```

**8.4 — FR-6.7: negative stock is surfaced, not blocked.** Expect `RSS-VAS-001` at
`-2` with `is_negative = true`.

```sql
select sku, current_stock, is_low_stock, is_negative from product_stock order by sku;
```

**8.5 — FR-6.2: wastage and adjustments must give a reason.** Expect
`ERROR: new row for relation "stock_movements" violates check constraint "stock_movements_reason_required"`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
  set local role authenticated;
  insert into stock_movements (product_id, movement_type, quantity)
  values ('40000000-0000-4000-8000-000000000001','wastage', -5);
rollback;
```

---

## 9. suppliers, purchases, purchase_items, supplier_payments — sales has NO ACCESS

| Policy                                                          | Command                              | Rule                       |
| --------------------------------------------------------------- | ------------------------------------ | -------------------------- |
| `suppliers_select`, `purchases_select`, `purchase_items_select` | SELECT                               | owner, manager, accountant |
| `suppliers_write`, `purchases_write`, `purchase_items_write`    | ALL                                  | owner, manager             |
| `supplier_payments_select` / `_insert`                          | SELECT / INSERT                      | owner, manager, accountant |
| **(none)**                                                      | UPDATE / DELETE on supplier_payments | **append-only**            |

**9.1 — FR-7.5: sales sees nothing at all.** Expect `0, 0, 0, 0`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  select (select count(*) from suppliers)         as suppliers,
         (select count(*) from purchases)         as purchases,
         (select count(*) from purchase_items)    as items,
         (select count(*) from supplier_payments) as payments;
rollback;
```

**9.2 — Accountant may read purchases but not create one.** Expect 2 then `UPDATE 0`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  select count(*) from purchases;
  update purchases set total_cents = 1 where purchase_number is not null;
rollback;
```

**9.3 — FR-7.6: receiving a purchase writes stock, and does so only once.** Run twice;
the movement count must not change on the second run.

```sql
select count(*) as purchase_in_movements
from stock_movements where source_table = 'purchases';
```

Expect 4. The unique index on `(source_table, source_id, product_id, movement_type)`
is what makes a replayed sync idempotent (T6).

---

## 10. employees, advances, payroll — "Full / View only / Prepare only / No access"

| Policy                        | Command         | Rule                                            |
| ----------------------------- | --------------- | ----------------------------------------------- |
| `employees_select`            | SELECT          | owner, manager, accountant                      |
| `employees_write`             | ALL             | owner, accountant (manager is view-only)        |
| `advances_select`             | SELECT          | owner, manager, accountant                      |
| `advances_insert` / `_update` | INSERT / UPDATE | owner, manager                                  |
| `payroll_runs_select`         | SELECT          | owner, manager, accountant                      |
| `payroll_runs_insert`         | INSERT          | owner, accountant                               |
| `payroll_runs_update`         | UPDATE          | owner; accountant only while `status = 'draft'` |
| `payroll_items_select`        | SELECT          | owner, manager, accountant                      |
| `payroll_items_write`         | ALL             | owner; accountant while the run is draft        |

**10.1 — FR-8.8: sales never sees payroll.** Expect `0, 0, 0, 0`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  select (select count(*) from employees)     as employees,
         (select count(*) from advances)      as advances,
         (select count(*) from payroll_runs)  as runs,
         (select count(*) from payroll_items) as items;
rollback;
```

This one carries legal weight, not just product weight: `employees` and
`payroll_items` hold personal data under the Data Protection Act 2019 (PRD §9).

**10.2 — Manager is view-only on payroll.** Expect 4 rows then `UPDATE 0`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
  set local role authenticated;
  select count(*) from employees;
  update employees set basic_pay_cents = 1 where national_id = '30000001';
rollback;
```

**10.3 — FR-8.5: only the owner approves a payroll run.** Expect
`ERROR: Only the owner may approve a payroll run`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  update payroll_runs set status = 'approved', approved_at = now(),
                          approved_by = '33333333-3333-4333-8333-333333333333'
   where id = 'b0000000-0000-4000-8000-000000000001';
rollback;
```

**10.4 — The accountant may prepare, but only while the run is draft.** Expect
`UPDATE 1`, then `UPDATE 0` once it is approved.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  update payroll_runs set totals = '{"note":"editing a draft"}'
   where id = 'b0000000-0000-4000-8000-000000000001';
rollback;

begin;
  update payroll_runs set status = 'approved', approved_at = now(),
                          approved_by = '11111111-1111-4111-8111-111111111111'
   where id = 'b0000000-0000-4000-8000-000000000001';
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  update payroll_runs set totals = '{"note":"editing an approved run"}'
   where id = 'b0000000-0000-4000-8000-000000000001';
rollback;
```

**10.5 — FR-8.3: only the owner approves an advance.** Expect
`ERROR: Only the owner may approve a salary advance`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
  set local role authenticated;
  update advances set status = 'approved', approved_at = now(),
                      approved_by = '22222222-2222-4222-8222-222222222222'
   where id = 'a0000000-0000-4000-8000-000000000001';
rollback;
```

---

## 11. Settings, audit log, sync devices, and the public website surface

### 11.1 company_settings, tax_config, statutory_rates

| Policy                                      | Command         | Rule                                            |
| ------------------------------------------- | --------------- | ----------------------------------------------- |
| `*_select`                                  | SELECT          | any active staff — every document renders these |
| `company_settings_update` / `_insert`       | UPDATE / INSERT | owner only                                      |
| `tax_config_write`, `statutory_rates_write` | ALL             | owner only (FR-9.3)                             |

Expect 4 rows then `UPDATE 0`:

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  select count(*) from statutory_rates;
  update statutory_rates set config = '{"tampered":true}' where kind = 'paye';
rollback;
```

### 11.2 audit_log — read by owner and manager, written by nobody

| Policy             | Command                  | Rule                                        |
| ------------------ | ------------------------ | ------------------------------------------- |
| `audit_log_select` | SELECT                   | owner, manager                              |
| **(none)**         | INSERT / UPDATE / DELETE | **no policy for any role, including owner** |

**11.2a — Accountant and sales see nothing.** Expect `0`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
  set local role authenticated;
  select count(*) from audit_log;
rollback;
```

**11.2b — The owner cannot tamper with it.** Both expect
`ERROR: permission denied for table audit_log`.

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
  set local role authenticated;
  update audit_log set action = 'tampered';
rollback;

begin;
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
  set local role authenticated;
  delete from audit_log;
rollback;
```

**11.2c — It fills itself.** Record a payment as sales, then confirm the owner sees a
new `payment.record` row that the client never wrote.

```sql
select action, entity_table, actor_role, occurred_at, recorded_at
from audit_log order by recorded_at desc limit 10;
```

`occurred_at` is device time and `recorded_at` is server time. The gap between them
is exactly the offline window — the first thing to look at when investigating a
discrepancy.

### 11.3 sync_devices

| Policy                            | Command         | Rule                                               |
| --------------------------------- | --------------- | -------------------------------------------------- |
| `sync_devices_select`             | SELECT          | owner and manager see all; everyone sees their own |
| `sync_devices_insert` / `_update` | INSERT / UPDATE | own row only (`profile_id = auth.uid()`)           |

Expect `ERROR: new row violates row-level security policy`:

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
  set local role authenticated;
  insert into sync_devices (id, profile_id, platform)
  values (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'android');
rollback;
```

### 11.4 website_contact_messages — the only anon-reachable table

| Policy                         | Command | Rule           |
| ------------------------------ | ------- | -------------- |
| `website_contact_insert_anon`  | INSERT  | **anon**       |
| `website_contact_select_staff` | SELECT  | owner, manager |
| `website_contact_update_staff` | UPDATE  | owner, manager |

**11.4a — Anon may post the contact form.** Expect `INSERT 0 1`.

```sql
begin;
  set local role anon;
  insert into website_contact_messages (name, email, message)
  values ('Test Visitor', 'visitor@example.com', 'Do you deliver to Naivasha?');
rollback;
```

**11.4b — Anon may not read it back.** Expect
`ERROR: permission denied for table website_contact_messages`.

```sql
begin; set local role anon; select * from website_contact_messages; rollback;
```

**11.4c — Anon can reach nothing else in the schema.** This is the check that proves
PRD §7's "anon role reaches only the website contact-form table". Every statement must
fail with _permission denied_.

```sql
begin; set local role anon; select * from clients;      rollback;
begin; set local role anon; select * from invoices;     rollback;
begin; set local role anon; select * from payments;     rollback;
begin; set local role anon; select * from employees;    rollback;
begin; set local role anon; select * from profiles;     rollback;
begin; set local role anon; select * from audit_log;    rollback;
```

---

## 12. Structural checks — run after every migration

These do not test a policy; they test that no table slipped through unprotected. Run
them whenever a migration adds a table.

**12.1 — RLS is enabled AND forced on every table.** Expect `25 / 25 / 25`.
`FORCE` matters: without it the table owner bypasses policies, which would make a
`SECURITY DEFINER` helper a leak.

```sql
select count(*) filter (where relrowsecurity)      as enabled,
       count(*) filter (where relforcerowsecurity) as forced,
       count(*)                                    as total
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
```

**12.2 — No table has RLS on but zero policies.** Expect **0 rows**. Such a table is
not "secure", it is unreachable — a bug that surfaces as a mysteriously empty screen.

```sql
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname);
```

**12.3 — Append-only tables have no UPDATE or DELETE policy.** Expect **0 rows**.

```sql
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
  and tablename in ('payments','reversals','stock_movements','supplier_payments','audit_log')
  and cmd in ('UPDATE','DELETE','ALL');
```

**12.4 — `authenticated` holds no UPDATE/DELETE grant on append-only tables.**
Expect **0 rows**.

```sql
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_name in ('payments','reversals','stock_movements','supplier_payments','audit_log')
  and privilege_type in ('UPDATE','DELETE');
```

**12.5 — `anon` can only insert into the contact table.** Expect exactly one row:
`website_contact_messages | INSERT`.

```sql
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by table_name, privilege_type;
```

**12.6 — Every reporting view is `security_invoker`.** Expect **0 rows**. A view
without it runs as its owner and would hand a sales user the whole company's figures.

```sql
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and coalesce((select option_value from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker'), 'false') <> 'true';
```

**12.7 — Every SECURITY DEFINER function pins its search_path.** Expect **0 rows**.
An unpinned one is a privilege-escalation vector: a caller could shadow `profiles`
with their own table.

```sql
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'app' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) cfg
                  where cfg like 'search_path=%');
```

---

## 13. What these tests do not cover

Stated plainly so the gaps are known rather than assumed:

- **Column-level exposure.** Every role that can select `profiles` sees all columns,
  including email and phone. If that is unacceptable, add column grants; RLS is
  row-level only.
- **Rate limiting on the anon insert.** `website_contact_messages` is insert-only and
  length-capped, but nothing here stops an automated flood. The captcha check belongs
  in an edge function in front of the insert (PRD §7).
- **JWT validity.** These checks impersonate by setting a claim directly. They prove
  the policies given a `sub`; they do not prove Supabase Auth issues, expires or
  revokes tokens correctly. Test revocation against a real login (§3.5, T4).
- **The sync engine.** T1, T2, T5 and T6 are device-level behaviours
  (architecture.md §6) and need two real devices, not SQL.
- **Concurrency** is now covered, though not by this file. Four concurrent sessions
  inserting 25 issued invoices each produced 100 distinct numbers, 1–100, with no
  gaps and no duplicates. Re-run it after any change to
  `app.allocate_document_number`:

  ```bash
  # 4 sessions x 25 invoices into a fresh year, then check the sequence
  for n in 1 2 3 4; do psql "$DB_URL" -q -f burst.sql & done; wait
  psql "$DB_URL" -c "select count(*), count(distinct invoice_number),
                            min(seq), max(seq) from (...)"
  ```
