-- ============================================================================
-- Salary payouts in the books.
--
-- A salary paid through IntaSend leaves the IntaSend wallet, not the farm's
-- M-Pesa line or bank account, and IntaSend takes a charge on top of the
-- amount (2026-11-24 sandbox: KES 10 on a KES 625 M-Pesa payout). The Ledger
-- now places those payouts in an IntaSend wallet account and records the
-- charge as an expense. Funding the wallet is a Transfer into it.
-- ============================================================================

-- IntaSend's own charge for a paid payout, from its status answer
-- (transactions[0].charge). Null when IntaSend did not say.
alter table public.payroll_payouts
  add column if not exists fee_cents bigint check (fee_cents is null or fee_cents >= 0);

comment on column public.payroll_payouts.fee_cents is
  'IntaSend''s charge for the transfer, in cents, taken from the wallet on top of amount_cents. Set by the server on settlement.';

alter table public.money_accounts drop constraint if exists money_accounts_kind_check;
alter table public.money_accounts
  add constraint money_accounts_kind_check check (kind in ('cash', 'mpesa', 'bank', 'wallet'));

insert into public.money_accounts (name, kind, currency, is_default, details)
select 'IntaSend wallet', 'wallet', 'KES', true,
       'Salary payouts are paid from here. Record each top-up as a transfer into this account.'
where not exists (
  select 1 from public.money_accounts
  where kind = 'wallet' and currency = 'KES' and deleted_at is null
);
