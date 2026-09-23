-- ============================================================================
-- 0012  Derived values as views. Never as columns.
--
-- Implements: architecture.md §3.
--
-- Every view is security_invoker so the CALLER's RLS applies. A security
-- definer view would silently hand a sales user the whole company's figures.
-- ============================================================================

-- ---------------------------------------------------------- invoice_balances

create view public.invoice_balances with (security_invoker = true) as
select i.id                                                     as invoice_id,
       i.client_id,
       i.total_cents,
       coalesce(p.paid_cents, 0)                                as paid_cents,
       coalesce(r.reversed_cents, 0)                            as reversed_cents,
       i.total_cents - coalesce(p.paid_cents, 0) + coalesce(r.reversed_cents, 0)
                                                                as balance_cents
from public.invoices i
left join lateral (
  select sum(amount_cents) as paid_cents
  from public.payments
  where invoice_id = i.id
) p on true
left join lateral (
  select sum(rv.amount_cents) as reversed_cents
  from public.reversals rv
  join public.payments pm on pm.id = rv.payment_id
  where pm.invoice_id = i.id
) r on true
where i.deleted_at is null;

comment on view public.invoice_balances is
  'FR-5.4: balance is always computed from payments, never a stored editable field.';

-- ------------------------------------------------------------ invoice_status

-- FR-5.6. `overdue` is evaluated at read time against current_date, so it is
-- correct on a device that has been offline for a week with no job having run.
create view public.invoice_status with (security_invoker = true) as
select i.id as invoice_id,
       i.invoice_number,
       i.client_id,
       i.issue_date,
       i.due_date,
       b.total_cents,
       b.paid_cents,
       b.balance_cents,
       case
         when i.status = 'draft'        then 'draft'
         when i.status = 'voided'       then 'voided'
         when b.balance_cents <= 0      then 'paid'
         when i.due_date < current_date then 'overdue'
         when b.paid_cents > 0          then 'partially_paid'
         else 'unpaid'
       end as derived_status
from public.invoices i
join public.invoice_balances b on b.invoice_id = i.id
where i.deleted_at is null;

-- -------------------------------------------------------------- product_stock

create view public.product_stock with (security_invoker = true) as
select p.id                                                     as product_id,
       p.sku,
       p.name,
       coalesce(sum(m.quantity), 0)                             as current_stock,
       p.low_stock_threshold,
       coalesce(sum(m.quantity), 0) <= p.low_stock_threshold    as is_low_stock,
       coalesce(sum(m.quantity), 0) < 0                         as is_negative
from public.products p
left join public.stock_movements m on m.product_id = p.id
where p.deleted_at is null
group by p.id, p.sku, p.name, p.low_stock_threshold;

comment on view public.product_stock is
  'FR-6.2: current stock is a sum over movements. Negative stock is surfaced, not blocked (FR-6.7).';

-- ------------------------------------------------------------ client_balances

-- FR-2.4 / FR-3.3: outstanding per client with the aging buckets the dashboard
-- needs. Buckets are measured from the due date, not the issue date.
create view public.client_balances with (security_invoker = true) as
select c.id as client_id,
       c.name,
       coalesce(sum(b.balance_cents), 0) as outstanding_cents,
       coalesce(sum(b.balance_cents) filter (
         where current_date - i.due_date <= 30), 0) as bucket_0_30_cents,
       coalesce(sum(b.balance_cents) filter (
         where current_date - i.due_date between 31 and 60), 0) as bucket_31_60_cents,
       coalesce(sum(b.balance_cents) filter (
         where current_date - i.due_date between 61 and 90), 0) as bucket_61_90_cents,
       coalesce(sum(b.balance_cents) filter (
         where current_date - i.due_date > 90), 0) as bucket_90_plus_cents
from public.clients c
left join public.invoices i
  on i.client_id = c.id and i.status = 'issued' and i.deleted_at is null
left join public.invoice_balances b on b.invoice_id = i.id
where c.deleted_at is null
group by c.id, c.name;

-- ---------------------------------------------------------- supplier_balances

create view public.supplier_balances with (security_invoker = true) as
select s.id as supplier_id,
       s.name,
       coalesce(sum(pu.total_cents), 0) - coalesce(sum(sp.paid_cents), 0) as payable_cents
from public.suppliers s
left join public.purchases pu
  on pu.supplier_id = s.id and pu.status in ('received', 'ordered') and pu.deleted_at is null
left join lateral (
  select sum(amount_cents) as paid_cents
  from public.supplier_payments
  where purchase_id = pu.id
) sp on true
where s.deleted_at is null
group by s.id, s.name;

-- --------------------------------------------------------------- daily_sales

-- FR-2.1 / FR-2.2. Grouped in Africa/Nairobi, not UTC: a sale at 01:00 Nairobi
-- belongs to that day, and grouping in UTC would file it under the previous one.
create view public.daily_sales with (security_invoker = true) as
select (i.created_at at time zone 'Africa/Nairobi')::date as sales_date,
       count(*)                                            as invoice_count,
       coalesce(sum(i.total_cents), 0)                     as invoiced_cents
from public.invoices i
where i.status = 'issued' and i.deleted_at is null
group by 1;

-- -------------------------------------------------------- inventory_valuation

create view public.inventory_valuation with (security_invoker = true) as
select ps.product_id,
       ps.sku,
       ps.name,
       ps.current_stock,
       p.cost_price_cents,
       round(ps.current_stock * p.cost_price_cents)::bigint as valuation_cents
from public.product_stock ps
join public.products p on p.id = ps.product_id;

-- ------------------------------------------------------------ wastage_report

create view public.wastage_report with (security_invoker = true) as
select m.id,
       m.product_id,
       p.sku,
       p.name,
       -m.quantity                                  as wasted_quantity,
       m.reason,
       m.occurred_at,
       round(-m.quantity * coalesce(m.unit_cost_cents, p.cost_price_cents))::bigint as cost_cents
from public.stock_movements m
join public.products p on p.id = m.product_id
where m.movement_type = 'wastage';
