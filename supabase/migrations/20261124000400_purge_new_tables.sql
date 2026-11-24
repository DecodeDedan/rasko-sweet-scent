-- ============================================================================
-- The business purge must clear the tables added since it was written:
-- casual_work_entries (references employees), the ledger entries, and the
-- pack house deliveries (reference clients, products and orders). Without
-- them the purge fails on a foreign key half-way through its transaction.
-- Money accounts and ledger categories are reference data and stay.
--
-- Public wrapper: PostgREST exposes only `public`, so the edge function's
-- rpc('purge_business_data') needs a public entry point (same as payroll).
-- ============================================================================

create or replace function app.purge_business_data()
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Only a super admin can purge business data.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.packhouse_delivery_lines;
  delete from public.packhouse_deliveries;
  delete from public.ledger_entries;
  delete from public.casual_work_entries;
  delete from public.payroll_payouts;
  delete from public.supplier_payments;
  delete from public.reversals;
  delete from public.payments;
  delete from public.payroll_items;
  delete from public.advances;
  delete from public.purchase_items;
  delete from public.purchases;
  delete from public.order_items;
  delete from public.invoices;
  delete from public.stock_movements;
  delete from public.product_prices;
  delete from public.products;
  delete from public.orders;
  delete from public.suppliers;
  delete from public.employees;
  delete from public.payroll_runs;
  delete from public.clients;
  delete from public.categories;
  delete from public.outbound_emails;
  delete from public.email_templates;

  insert into public.audit_log (
    actor_id, actor_role, action, entity_table, entity_id, before, after,
    changed_fields, reason
  )
  values (
    auth.uid(), 'owner', 'business_data.purge', 'business_data', null,
    jsonb_build_object('purged', true),
    jsonb_build_object('purged', true),
    array[
      'packhouse_delivery_lines', 'packhouse_deliveries', 'ledger_entries',
      'casual_work_entries', 'payroll_payouts', 'supplier_payments', 'reversals', 'payments',
      'payroll_items', 'advances', 'purchase_items', 'purchases',
      'order_items', 'invoices', 'stock_movements', 'product_prices',
      'products', 'orders', 'suppliers', 'employees', 'payroll_runs',
      'clients', 'categories', 'outbound_emails', 'email_templates'
    ],
    'Super admin purge of business/test data'
  );
end;
$$;

revoke all on function app.purge_business_data() from public;
grant execute on function app.purge_business_data() to authenticated;

create or replace function public.purge_business_data()
returns void
language sql
security invoker
set search_path = public, app, pg_temp
as $$
  select app.purge_business_data();
$$;

revoke all on function public.purge_business_data() from public, anon;
grant execute on function public.purge_business_data() to authenticated;
