-- ============================================================================
-- Reporting views that sum sales money, split by currency.
--
-- Since 20260930000200 an invoice can be priced in dollars as well as
-- shillings, and every *_cents figure is in that invoice's currency. Summing
-- total_cents across invoices would add dollars to shillings, so each view
-- that aggregates sales money now groups by currency as well:
--
--   invoice_balances  + currency (one row per invoice already; payments and
--   invoice_status    + currency  reversals have no currency of their own,
--                                 they are in their invoice's)
--   client_balances   one row per (client, currency) with a `currency` column.
--                     A client with no issued invoices still appears once,
--                     as 'KES' with zero figures.
--   daily_sales       one row per (date, currency) with a `currency` column.
--
-- Existing column names and meanings are unchanged; `currency` is appended
-- last, so `create or replace` keeps the grants from 0013 and the dependency
-- between invoice_status and invoice_balances. Nothing else in the schema
-- depends on these views (send-email reads invoice_status with select *).
--
-- Reverse: drop client_balances, daily_sales and invoice_status, then
-- invoice_balances, recreate all four from 20260901001200_views.sql and
-- re-run the view grant from 20260901001300_rls_policies.sql.
-- ============================================================================

create or replace view public.invoice_balances with (security_invoker = true) as
select i.id                                                     as invoice_id,
       i.client_id,
       i.total_cents,
       coalesce(p.paid_cents, 0)                                as paid_cents,
       coalesce(r.reversed_cents, 0)                            as reversed_cents,
       i.total_cents - coalesce(p.paid_cents, 0) + coalesce(r.reversed_cents, 0)
                                                                as balance_cents,
       i.currency
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

create or replace view public.invoice_status with (security_invoker = true) as
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
       end as derived_status,
       i.currency
from public.invoices i
join public.invoice_balances b on b.invoice_id = i.id
where i.deleted_at is null;

-- FR-2.4 / FR-3.3: outstanding per client and currency, with aging buckets
-- measured from the due date.
create or replace view public.client_balances with (security_invoker = true) as
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
         where current_date - i.due_date > 90), 0) as bucket_90_plus_cents,
       coalesce(i.currency, 'KES') as currency
from public.clients c
left join public.invoices i
  on i.client_id = c.id and i.status = 'issued' and i.deleted_at is null
left join public.invoice_balances b on b.invoice_id = i.id
where c.deleted_at is null
group by c.id, c.name, coalesce(i.currency, 'KES');

-- FR-2.1 / FR-2.2, grouped in Africa/Nairobi and by currency.
create or replace view public.daily_sales with (security_invoker = true) as
select (i.created_at at time zone 'Africa/Nairobi')::date as sales_date,
       count(*)                                            as invoice_count,
       coalesce(sum(i.total_cents), 0)                     as invoiced_cents,
       i.currency
from public.invoices i
where i.status = 'issued' and i.deleted_at is null
group by 1, i.currency;
