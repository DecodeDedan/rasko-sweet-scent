-- ============================================================================
-- 0014  Audit triggers.
--
-- Implements: architecture.md §7.2. PRD §3: "Every sensitive action (payment,
-- payroll approval, delete, price change, role change, stock adjustment) writes
-- to the audit log: user, timestamp, before/after values."
--
-- WHEN clauses keep the log to sensitive events. Auditing every UPDATE would
-- bury the six things that matter under thousands of routine edits.
-- ============================================================================

-- ------------------------------------------------------------------ payments

create trigger payments_audit
  after insert on public.payments
  for each row execute function app.write_audit('payment.record');

create trigger reversals_audit
  after insert on public.reversals
  for each row execute function app.write_audit('payment.reverse');

create trigger supplier_payments_audit
  after insert on public.supplier_payments
  for each row execute function app.write_audit('supplier_payment.record');

-- ----------------------------------------------------------- payroll approval

create trigger payroll_runs_audit_approve
  after update on public.payroll_runs
  for each row
  when (old.status is distinct from new.status and new.status in ('approved', 'paid'))
  execute function app.write_audit('payroll.approve');

create trigger advances_audit_approve
  after update on public.advances
  for each row
  when (old.status is distinct from new.status and new.status = 'approved')
  execute function app.write_audit('advance.approve');

-- -------------------------------------------------------------------- deletes

create trigger clients_audit_delete
  after update on public.clients
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function app.write_audit('client.delete');

create trigger orders_audit_delete
  after update on public.orders
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function app.write_audit('order.delete');

create trigger orders_audit_cancel
  after update on public.orders
  for each row when (old.status is distinct from new.status and new.status = 'cancelled')
  execute function app.write_audit('order.cancel');

create trigger invoices_audit_delete
  after update on public.invoices
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function app.write_audit('invoice.delete');

create trigger invoices_audit_void
  after update on public.invoices
  for each row when (old.status is distinct from new.status and new.status = 'voided')
  execute function app.write_audit('invoice.void');

create trigger products_audit_delete
  after update on public.products
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function app.write_audit('product.delete');

create trigger employees_audit_delete
  after update on public.employees
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function app.write_audit('employee.delete');

-- -------------------------------------------------------------- price changes

create trigger products_audit_price
  after update on public.products
  for each row
  when (old.selling_price_cents is distinct from new.selling_price_cents
        or old.cost_price_cents is distinct from new.cost_price_cents)
  execute function app.write_audit('product.price_change');

create trigger product_prices_audit
  after insert or update on public.product_prices
  for each row execute function app.write_audit('product.price_change');

-- --------------------------------------------------------------- role changes

create trigger profiles_audit_role
  after update on public.profiles
  for each row
  when (old.role is distinct from new.role or old.is_active is distinct from new.is_active)
  execute function app.write_audit('profile.role_change');

create trigger profiles_audit_create
  after insert on public.profiles
  for each row execute function app.write_audit('profile.create');

-- ----------------------------------------------------------- stock adjustment

-- Only adjustments and wastage are audited. purchase_in and sale are already
-- explained by the purchase or order that produced them; auditing those would
-- duplicate the ledger without adding accountability.
create trigger stock_movements_audit_adjust
  after insert on public.stock_movements
  for each row when (new.movement_type in ('adjustment', 'wastage'))
  execute function app.write_audit('stock.adjust');

-- -------------------------------------------------------------------- settings

create trigger company_settings_audit
  after update on public.company_settings
  for each row execute function app.write_audit('settings.company_change');

create trigger tax_config_audit
  after insert or update on public.tax_config
  for each row execute function app.write_audit('settings.tax_change');

create trigger statutory_rates_audit
  after insert or update on public.statutory_rates
  for each row execute function app.write_audit('settings.statutory_change');
