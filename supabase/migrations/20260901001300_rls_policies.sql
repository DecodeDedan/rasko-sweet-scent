-- ============================================================================
-- 0013  Row Level Security policies.
--
-- Implements: architecture.md §5, transcribed from the PRD §3.1 matrix.
--
-- Read this file next to that table. Every policy below names the matrix cell
-- it implements. When the PRD changes, change this file and nothing else.
--
-- Principles (architecture.md §5.1):
--   1. RLS is the enforcement layer, always. The UI hides what a role cannot
--      use; hiding is never the security mechanism. Every policy must hold
--      against a caller with the anon key, a valid JWT and raw PostgREST calls.
--   2. RLS is ENABLED and FORCED on every table (done in earlier migrations).
--   3. Default deny. No policy means no access.
--   4. Every policy tests is_active, via app.current_user_role() returning NULL
--      for a deactivated user (T4).
-- ============================================================================

-- --------------------------------------------------------------- soft delete

-- Soft-deleting is an UPDATE that sets deleted_at, so it cannot be expressed as
-- a DELETE policy. This trigger carries the matrix's delete column; the allowed
-- roles are passed as a trigger argument.
create or replace function app.guard_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed text[] := string_to_array(tg_argv[0], ',');
begin
  -- Skipped when there is no authenticated caller: that is an admin or
  -- service_role context (migration, SQL editor, backend job), which is trusted.
  if auth.uid() is not null
     and new.deleted_at is not null and old.deleted_at is null
     and not (coalesce(app.current_user_role(), '') = any (v_allowed))
  then
    raise exception 'Role % may not delete from % (PRD 3.1).',
      coalesce(app.current_user_role(), 'unauthenticated'), tg_table_name
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger clients_guard_delete_role before update on public.clients
  for each row execute function app.guard_soft_delete('owner,manager');
create trigger orders_guard_delete_role before update on public.orders
  for each row execute function app.guard_soft_delete('owner,manager');
create trigger invoices_guard_delete_role before update on public.invoices
  for each row execute function app.guard_soft_delete('owner,manager');
create trigger products_guard_delete_role before update on public.products
  for each row execute function app.guard_soft_delete('owner,manager');
create trigger suppliers_guard_delete_role before update on public.suppliers
  for each row execute function app.guard_soft_delete('owner,manager');
create trigger purchases_guard_delete_role before update on public.purchases
  for each row execute function app.guard_soft_delete('owner,manager');
create trigger employees_guard_delete_role before update on public.employees
  for each row execute function app.guard_soft_delete('owner,accountant');
create trigger payroll_runs_guard_delete_role before update on public.payroll_runs
  for each row execute function app.guard_soft_delete('owner');

-- FR-4.2: cancelling an order requires manager or owner.
create or replace function app.guard_order_cancel()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and new.status = 'cancelled' and old.status <> 'cancelled' and not app.is_staff() then
    raise exception 'Only a manager or the owner may cancel an order (FR-4.2).'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger orders_guard_cancel before update on public.orders
  for each row execute function app.guard_order_cancel();

-- FR-5.6: voiding an invoice is a manager/owner action.
create or replace function app.guard_invoice_void()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and new.status = 'voided' and old.status <> 'voided' and not app.is_staff() then
    raise exception 'Only a manager or the owner may void an invoice.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger invoices_guard_void before update on public.invoices
  for each row execute function app.guard_invoice_void();

-- ============================================================================
-- profiles  —  PRD 3.1 "Users & settings": Full / Limited / No access / No access
--
-- Note: that matrix row governs MANAGING users. Reading colleague names is a
-- separate need — order.taken_by and payment.received_by pickers require it for
-- every role — so select is open to all active staff while writes are owner-only.
-- ============================================================================

create policy profiles_select_staff on public.profiles
  for select to authenticated
  using (app.is_authenticated_staff());

create policy profiles_insert_owner on public.profiles
  for insert to authenticated
  with check (app.is_owner());

-- FR-1.3: only the owner may change a role. The WITH CHECK matters as much as
-- the USING clause — without it a permitted update could change the row into
-- something the role was never allowed to produce.
create policy profiles_update_owner on public.profiles
  for update to authenticated
  using (app.is_owner())
  with check (app.is_owner());

-- Anyone may edit their own contact details, but not their role or activation
-- (the profiles_guard_privileges trigger from 0002 blocks that).
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ============================================================================
-- clients  —  PRD 3.1 "Clients": All / All / All / Own clients only
-- ============================================================================

create policy clients_select on public.clients
  for select to authenticated
  using (
    app.can_see_finance()
    or (app.current_user_role() = 'sales' and created_by = auth.uid())  -- FR-3.4
  );

create policy clients_insert on public.clients
  for insert to authenticated
  with check (app.is_authenticated_staff());

create policy clients_update on public.clients
  for update to authenticated
  using (
    app.can_see_finance()
    or (app.current_user_role() = 'sales' and created_by = auth.uid())
  )
  with check (
    app.can_see_finance()
    or (app.current_user_role() = 'sales' and created_by = auth.uid())
  );

-- ============================================================================
-- orders  —  PRD 3.1 "Orders": All / All / View all / Create, no delete
-- ============================================================================

create policy orders_select on public.orders
  for select to authenticated
  using (
    app.can_see_finance()
    or (app.current_user_role() = 'sales' and (created_by = auth.uid() or taken_by = auth.uid()))
  );

-- Accountant is "View all": no insert.
create policy orders_insert on public.orders
  for insert to authenticated
  with check (app.is_staff() or app.current_user_role() = 'sales');

create policy orders_update_staff on public.orders
  for update to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- FR-4.5: sales edit only their OWN orders and only while still draft.
-- WITH CHECK is not redundant: without it a sales user could update their draft
-- and set created_by to someone else, or move it out of draft and keep editing.
create policy orders_update_sales on public.orders
  for update to authenticated
  using (
    app.current_user_role() = 'sales'
    and created_by = auth.uid()
    and status = 'draft'
  )
  with check (
    app.current_user_role() = 'sales'
    and created_by = auth.uid()
    and status = 'draft'
  );

-- ============================================================================
-- order_items  —  inherits the parent order's policy
-- ============================================================================

create policy order_items_select on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy order_items_insert on public.order_items
  for insert to authenticated
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id
      and (app.is_staff()
           or (app.current_user_role() = 'sales' and o.created_by = auth.uid() and o.status = 'draft'))
  ));

create policy order_items_update on public.order_items
  for update to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and (app.is_staff()
           or (app.current_user_role() = 'sales' and o.created_by = auth.uid() and o.status = 'draft'))
  ))
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id
      and (app.is_staff()
           or (app.current_user_role() = 'sales' and o.created_by = auth.uid() and o.status = 'draft'))
  ));

-- ============================================================================
-- invoices  —  PRD 3.1: All / All / Create/edit / Create invoice, record payment
-- ============================================================================

create policy invoices_select on public.invoices
  for select to authenticated
  using (
    app.can_see_finance()
    or (app.current_user_role() = 'sales' and created_by = auth.uid())
  );

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (app.is_authenticated_staff());

-- Sales may create an invoice but not edit one afterwards.
create policy invoices_update on public.invoices
  for update to authenticated
  using (app.can_see_finance())
  with check (app.can_see_finance());

-- ============================================================================
-- payments  —  PRD 3.1: All / All / Create/edit / Create invoice, record payment
--
-- APPEND-ONLY: there is deliberately NO update and NO delete policy for ANY
-- role, including owner (FR-5.5). The payments_append_only trigger closes the
-- table-owner path as well.
-- ============================================================================

create policy payments_select on public.payments
  for select to authenticated
  using (
    app.can_see_finance()
    or (app.current_user_role() = 'sales'
        and (created_by = auth.uid() or received_by = auth.uid()))
  );

create policy payments_insert on public.payments
  for insert to authenticated
  with check (app.is_authenticated_staff());

-- ============================================================================
-- reversals  —  FR-5.5: restricted to manager and owner
-- ============================================================================

create policy reversals_select on public.reversals
  for select to authenticated
  using (app.can_see_finance());

create policy reversals_insert on public.reversals
  for insert to authenticated
  with check (app.is_staff());

-- ============================================================================
-- categories / products / product_prices
--   PRD 3.1 "Products & inventory": All / All / View / View
-- ============================================================================

create policy categories_select on public.categories
  for select to authenticated using (app.is_authenticated_staff());
create policy categories_write on public.categories
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy products_select on public.products
  for select to authenticated using (app.is_authenticated_staff());
create policy products_write on public.products
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy product_prices_select on public.product_prices
  for select to authenticated using (app.is_authenticated_staff());
create policy product_prices_write on public.product_prices
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

-- ============================================================================
-- stock_movements  —  APPEND-ONLY. No update, no delete, for any role.
--
-- Sales never inserts directly: a sale writes movements through a SECURITY
-- DEFINER trigger as the order transitions.
-- ============================================================================

create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (app.is_authenticated_staff());

create policy stock_movements_insert on public.stock_movements
  for insert to authenticated
  with check (app.is_staff());

-- ============================================================================
-- suppliers / purchases / purchase_items / supplier_payments
--   PRD 3.1 "Suppliers & purchases": All / All / View / NO ACCESS
-- ============================================================================

create policy suppliers_select on public.suppliers
  for select to authenticated using (app.can_see_finance());
create policy suppliers_write on public.suppliers
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy purchases_select on public.purchases
  for select to authenticated using (app.can_see_finance());
create policy purchases_write on public.purchases
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy purchase_items_select on public.purchase_items
  for select to authenticated using (app.can_see_finance());
create policy purchase_items_write on public.purchase_items
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

-- Append-only: select and insert only. Accountant may record a payment.
create policy supplier_payments_select on public.supplier_payments
  for select to authenticated using (app.can_see_finance());
create policy supplier_payments_insert on public.supplier_payments
  for insert to authenticated with check (app.can_see_finance());

-- ============================================================================
-- employees / advances / payroll_runs / payroll_items
--   PRD 3.1 "Payroll": Full / View only / Prepare only / NO ACCESS
-- ============================================================================

create policy employees_select on public.employees
  for select to authenticated using (app.can_see_finance());

-- Owner full; accountant prepares. Manager is view-only.
create policy employees_write on public.employees
  for all to authenticated
  using (app.current_user_role() in ('owner', 'accountant'))
  with check (app.current_user_role() in ('owner', 'accountant'));

create policy advances_select on public.advances
  for select to authenticated using (app.can_see_finance());

-- FR-8.3: requested by manager or owner. Approval is owner-only, enforced by
-- the advances_guard_approval trigger from 0009.
create policy advances_insert on public.advances
  for insert to authenticated with check (app.is_staff());
create policy advances_update on public.advances
  for update to authenticated using (app.is_staff()) with check (app.is_staff());

create policy payroll_runs_select on public.payroll_runs
  for select to authenticated using (app.can_see_finance());

-- FR-8.5: prepared by accountant or owner; approved by owner only (trigger).
create policy payroll_runs_insert on public.payroll_runs
  for insert to authenticated
  with check (app.current_user_role() in ('owner', 'accountant'));

-- The accountant may only touch a run that is still draft.
create policy payroll_runs_update on public.payroll_runs
  for update to authenticated
  using (
    app.is_owner()
    or (app.current_user_role() = 'accountant' and status = 'draft')
  )
  with check (
    app.is_owner()
    or (app.current_user_role() = 'accountant' and status = 'draft')
  );

create policy payroll_items_select on public.payroll_items
  for select to authenticated using (app.can_see_finance());

create policy payroll_items_write on public.payroll_items
  for all to authenticated
  using (
    app.is_owner()
    or (app.current_user_role() = 'accountant'
        and exists (select 1 from public.payroll_runs r
                    where r.id = payroll_run_id and r.status = 'draft'))
  )
  with check (
    app.is_owner()
    or (app.current_user_role() = 'accountant'
        and exists (select 1 from public.payroll_runs r
                    where r.id = payroll_run_id and r.status = 'draft'))
  );

-- ============================================================================
-- company_settings / tax_config / statutory_rates
--   PRD 3.1 "Users & settings": Full / Limited / No access / No access
--
-- Select is open to all staff: every document (invoice, receipt, payslip)
-- renders the company profile and the tax rate. Writing is owner-only (FR-9.3).
-- ============================================================================

create policy company_settings_select on public.company_settings
  for select to authenticated using (app.is_authenticated_staff());
create policy company_settings_update on public.company_settings
  for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy company_settings_insert on public.company_settings
  for insert to authenticated with check (app.is_owner());

create policy tax_config_select on public.tax_config
  for select to authenticated using (app.is_authenticated_staff());
create policy tax_config_write on public.tax_config
  for all to authenticated using (app.is_owner()) with check (app.is_owner());

create policy statutory_rates_select on public.statutory_rates
  for select to authenticated using (app.is_authenticated_staff());
create policy statutory_rates_write on public.statutory_rates
  for all to authenticated using (app.is_owner()) with check (app.is_owner());

-- ============================================================================
-- audit_log  —  PRD 3.1: Full / View / No access / No access
--
-- There is NO insert, update or delete policy for ANY role, including owner.
-- The only path in is app.write_audit(), which is SECURITY DEFINER.
-- ============================================================================

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (app.is_staff());

-- ============================================================================
-- sync_devices
-- ============================================================================

create policy sync_devices_select on public.sync_devices
  for select to authenticated
  using (app.is_staff() or profile_id = auth.uid());

create policy sync_devices_insert on public.sync_devices
  for insert to authenticated
  with check (profile_id = auth.uid());

create policy sync_devices_update on public.sync_devices
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ============================================================================
-- website_contact_messages  —  the ONLY anon-reachable table, insert only
-- ============================================================================

create policy website_contact_insert_anon on public.website_contact_messages
  for insert to anon
  with check (true);

create policy website_contact_select_staff on public.website_contact_messages
  for select to authenticated
  using (app.is_staff());

create policy website_contact_update_staff on public.website_contact_messages
  for update to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ============================================================================
-- Grants.
--
-- RLS filters rows; grants decide whether the role may attempt the verb at all.
-- Both are needed: a table with a permissive policy but no grant is unreachable,
-- and a grant without a policy returns nothing. Belt and braces.
-- ============================================================================

grant usage on schema public to anon, authenticated;
grant usage on schema app to anon, authenticated;

grant execute on function app.current_user_role()      to anon, authenticated;
grant execute on function app.is_owner()               to anon, authenticated;
grant execute on function app.is_staff()               to anon, authenticated;
grant execute on function app.can_see_finance()        to anon, authenticated;
grant execute on function app.is_authenticated_staff() to anon, authenticated;

-- Start from nothing for anon on every table, then re-grant the single
-- exception PRD §7 allows.
revoke all on all tables in schema public from anon;

grant select, insert, update on public.profiles, public.clients, public.orders,
  public.order_items, public.invoices, public.products, public.product_prices,
  public.categories, public.suppliers, public.purchases, public.purchase_items,
  public.employees, public.advances, public.payroll_runs, public.payroll_items,
  public.company_settings, public.tax_config, public.statutory_rates,
  public.sync_devices, public.website_contact_messages
  to authenticated;

-- Append-only tables: authenticated is never granted UPDATE or DELETE, so the
-- append-only rule holds even if a policy is added by mistake later.
grant select, insert on public.payments, public.reversals,
  public.stock_movements, public.supplier_payments
  to authenticated;

-- audit_log: select only. No role may write to it directly.
grant select on public.audit_log to authenticated;

grant select on public.invoice_balances, public.invoice_status,
  public.product_stock, public.client_balances, public.supplier_balances,
  public.daily_sales, public.inventory_valuation, public.wastage_report
  to authenticated;

-- The one anon capability in the entire schema.
grant insert on public.website_contact_messages to anon;

-- Supabase's bootstrap grants every NEW table in `public` to anon and
-- authenticated by default. The REVOKE above only covers tables that exist
-- right now, so a table added by a later migration would silently re-open the
-- anon surface. This makes the default deny for anon durable.
--
-- Any future migration that legitimately needs an anon-reachable table must
-- grant it explicitly, which is exactly the deliberate act PRD §7 requires.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
