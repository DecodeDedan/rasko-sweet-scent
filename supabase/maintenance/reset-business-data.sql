-- ============================================================================
-- Empties the business records so the system starts afresh after a test round.
--
--   supabase db query --linked -f supabase/maintenance/reset-business-data.sql
--
-- GONE   clients, the catalogue and its stock ledger, orders, invoices,
--        payments and reversals, suppliers and purchases, client emails, the
--        audit entries about all of those, and the INV-/ORD-/PUR- counters
--        (numbering restarts at 0001).
-- KEPT   accounts and roles, company profile, tax and statutory settings, the
--        four varieties, email templates and provider health, backups, payroll
--        (suspended, untested) and the audit history of users and settings.
--
-- Every device notices on its next sync: the server identity changes, so the
-- engine drops its local copy, outbox included, and pulls the empty one
-- (migration 20260926000300). A test row can never be pushed back.
--
-- One DO block, because `db query` runs a single statement, and a single
-- statement is one transaction: any failure leaves everything as it was. TRUNCATE does not
-- fire the row-level append-only guards; the audit log's guard is lifted only
-- for the one targeted delete and restored before commit.
-- ============================================================================

do $$
declare
  removed jsonb;
begin
  -- Counted first, so the record below says what this removed.
  select jsonb_build_object(
    'clients',   (select count(*) from public.clients),
    'products',  (select count(*) from public.products),
    'orders',    (select count(*) from public.orders),
    'invoices',  (select count(*) from public.invoices),
    'payments',  (select count(*) from public.payments),
    'suppliers', (select count(*) from public.suppliers),
    'purchases', (select count(*) from public.purchases)
  ) into removed;

  truncate
    public.outbound_emails,
    public.reversals,
    public.payments,
    public.invoices,
    public.order_items,
    public.orders,
    public.supplier_payments,
    public.purchase_items,
    public.purchases,
    public.suppliers,
    public.stock_movements,
    public.product_prices,
    public.products,
    public.clients;

  delete from app.document_counters;

  alter table public.audit_log disable trigger audit_log_append_only;
  delete from public.audit_log
  where entity_table in (
    'clients', 'products', 'product_prices', 'stock_movements', 'orders',
    'order_items', 'invoices', 'payments', 'reversals', 'suppliers', 'purchases',
    'purchase_items', 'supplier_payments', 'outbound_emails'
  );
  alter table public.audit_log enable trigger audit_log_append_only;

  update app.server_instance set id = gen_random_uuid(), created_at = now();

  -- The reset itself stays on the record: the audit log is meant to be
  -- permanent, so the one time it is pruned says so, when, and how much.
  insert into public.audit_log (action, entity_table, entity_id, after, reason)
  values (
    'system.reset_business_data',
    'server_instance',
    (select id from app.server_instance),
    removed,
    'Test data removed before go-live'
  );
end
$$;
