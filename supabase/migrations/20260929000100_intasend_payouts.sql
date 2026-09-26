-- ============================================================================
-- Salary payouts through IntaSend: M-Pesa and bank (PesaLink).
--
-- Owner-requested (2026-09-26), extending migration 20260927000100 and
-- recorded in docs/PROGRESS.md for client sign-off. Which provider sends a
-- payout is a function secret (PAYOUT_PROVIDER = daraja | intasend), so
-- switching back is a settings change, not a code change.
--
-- What changes:
--   * a payout has a CHANNEL, taken by the server from the employee's payment
--     method: 'mpesa' (a phone) or 'bank' (bank code + account, from
--     employees.payment_details). The device still names only the payslip line.
--   * a payout records which PROVIDER sent it, set by the function when it
--     claims the row, so an answer is always checked with the provider that
--     holds the money.
--   * conversation_id holds the provider's id for the request: Daraja's
--     ConversationID, or IntaSend's tracking_id.
--   * mpesa_receipt holds the provider's receipt: the M-Pesa receipt number,
--     or the PesaLink reference for a bank payout. (Kept, not renamed: the
--     column syncs to every device.)
--   * IntaSend payouts still 'accepted' after two minutes are asked about
--     again by the sweep: IntaSend's callback is a hint, and a missed one must
--     not leave a payslip waiting forever.
--
-- Every never-pay-twice rule of 20260927000100 stands unchanged.
-- ============================================================================

alter table public.payroll_payouts
  add column provider     text check (provider is null or provider in ('daraja', 'intasend')),
  add column channel      text not null default 'mpesa' check (channel in ('mpesa', 'bank')),
  add column bank_code    text check (bank_code is null or bank_code ~ '^[0-9]{1,4}$'),
  add column bank_account text check (bank_account is null or bank_account ~ '^[0-9A-Za-z]{5,24}$');

-- New rows only: a row written before this migration by a trusted caller is
-- not re-judged.
alter table public.payroll_payouts
  add constraint payroll_payouts_bank_has_account
    check (channel <> 'bank' or (bank_code is not null and bank_account is not null)) not valid,
  add constraint payroll_payouts_mpesa_has_phone
    check (channel <> 'mpesa' or msisdn is not null) not valid;

comment on column public.payroll_payouts.conversation_id is
  'The provider''s id for the request: Daraja ConversationID, or IntaSend tracking_id.';
comment on column public.payroll_payouts.mpesa_receipt is
  'The provider''s receipt: M-Pesa receipt number, or the PesaLink reference of a bank payout.';
comment on table public.payroll_payouts is
  'Salary payouts by M-Pesa or bank, through Daraja or IntaSend. Amount, channel and destination are set by the server, never the device. See migrations 20260927000100 and 20260929000100.';

create index payroll_payouts_accepted_idx on public.payroll_payouts (updated_at)
  where status = 'accepted';

-- ---------------------------------------------------------- the money rules
-- Mirrors supabase/functions/_shared/payouts/rules.js. Change one, change both.

create or replace function app.prepare_payroll_payout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run  record;
  item record;
  emp  record;
  shillings bigint;
  phone_digits text;
  code text;
  account text;
begin
  -- A trusted caller (service role, SQL editor) is not policed here; it is not
  -- the app. Every signed-in caller goes through every rule.
  if auth.uid() is null then
    return new;
  end if;

  if coalesce(app.current_user_role(), '') <> 'owner' then
    raise exception 'Only the owner can pay salaries (FR-8.5, FR-8.7).'
      using errcode = 'insufficient_privilege';
  end if;

  select * into run from public.payroll_runs where id = new.payroll_run_id and deleted_at is null;
  if not found or run.status not in ('approved', 'paid') then
    raise exception 'Approve the payroll run before paying it.' using errcode = 'check_violation';
  end if;

  select * into item from public.payroll_items
   where id = new.payroll_item_id and payroll_run_id = run.id and deleted_at is null;
  if not found then
    raise exception 'That payslip is not part of this payroll run.' using errcode = 'check_violation';
  end if;
  if item.paid_at is not null then
    raise exception 'That payslip is already paid.' using errcode = 'check_violation';
  end if;

  select * into emp from public.employees where id = item.employee_id;
  if not found then
    raise exception 'That payslip has no employee record.' using errcode = 'check_violation';
  end if;

  shillings := floor(item.net_pay_cents / 100.0)::bigint;

  if emp.payment_method = 'mpesa' then
    phone_digits := regexp_replace(coalesce(emp.phone, ''), '^\+', '');
    if phone_digits !~ '^254[17][0-9]{8}$' then
      raise exception 'The employee has no valid M-Pesa number.' using errcode = 'check_violation';
    end if;
    if shillings < 10 then
      raise exception 'Net pay is below the M-Pesa minimum.' using errcode = 'check_violation';
    end if;
    if shillings > 250000 then
      raise exception 'Net pay is above the M-Pesa limit; pay by bank.' using errcode = 'check_violation';
    end if;
    new.channel      := 'mpesa';
    new.msisdn       := phone_digits;
    new.bank_code    := null;
    new.bank_account := null;

  elsif emp.payment_method = 'bank' then
    code    := btrim(coalesce(emp.payment_details ->> 'bank_code', ''));
    account := regexp_replace(coalesce(emp.payment_details ->> 'account_number', ''), '[[:space:]-]', '', 'g');
    if code !~ '^[0-9]{1,4}$' or account !~ '^[0-9A-Za-z]{5,24}$' then
      raise exception 'The employee has no complete bank account.' using errcode = 'check_violation';
    end if;
    if shillings < 100 then
      raise exception 'Net pay is below the bank transfer minimum.' using errcode = 'check_violation';
    end if;
    if shillings > 999999 then
      raise exception 'Net pay is above the bank transfer limit.' using errcode = 'check_violation';
    end if;
    new.channel      := 'bank';
    new.msisdn       := null;
    new.bank_code    := code;
    new.bank_account := account;

  else
    raise exception 'The employee has no payment method.' using errcode = 'check_violation';
  end if;

  -- Whatever the device sent, these come from the approved run.
  new.employee_id     := item.employee_id;
  new.amount_cents    := shillings * 100;
  new.remainder_cents := item.net_pay_cents - new.amount_cents;
  new.provider        := null;
  new.status          := 'queued';
  new.attempts        := 0;
  new.conversation_id := null;
  new.mpesa_receipt   := null;
  new.result_code     := null;
  new.result_desc     := null;
  new.recipient_name  := null;
  new.settled_at      := null;
  new.created_at      := now();
  new.created_by      := auth.uid();
  return new;
end;
$$;

-- A paid payout settles its payslip line (FR-8.7) with the provider's
-- receipt, in the channel it went by, and the run once every line is paid.
create or replace function app.settle_payroll_payout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    update public.payroll_items
       set paid_at = coalesce(new.settled_at, now()),
           payment_method = new.channel,
           payment_reference = new.mpesa_receipt
     where id = new.payroll_item_id and paid_at is null;

    update public.payroll_runs r
       set status = 'paid'
     where r.id = new.payroll_run_id
       and r.status = 'approved'
       and not exists (
         select 1 from public.payroll_items i
          where i.payroll_run_id = r.id and i.deleted_at is null and i.paid_at is null
       );
  end if;
  return new;
end;
$$;

-- Same guard as 20260928000300; only the wording changes, because a payout
-- is no longer always M-Pesa.
create or replace function app.guard_payslip_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.paid_at, new.payment_method, new.payment_reference)
     is not distinct from (old.paid_at, old.payment_method, old.payment_reference)
  then
    return new;
  end if;

  if exists (
    select 1 from public.payroll_payouts p
     where p.payroll_item_id = old.id
       and p.deleted_at is null
       and p.status in ('queued', 'sending', 'accepted', 'unknown', 'paid')
  ) then
    raise exception 'This payslip is being paid out automatically. It is marked paid when the payment is confirmed, not by hand.'
      using errcode = 'check_violation';
  end if;

  if old.paid_at is not null then
    raise exception 'This payslip is already recorded as paid; its payment cannot be changed.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function app.guard_run_paid_by_hand()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or new.status is not distinct from old.status or new.status <> 'paid' then
    return new;
  end if;

  if exists (
    select 1 from public.payroll_payouts p
     where p.payroll_run_id = old.id
       and p.deleted_at is null
       and p.status in ('queued', 'sending', 'accepted', 'unknown')
  ) then
    raise exception 'Salaries in this run are still being paid out. It is marked paid when every payment is confirmed.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------- sweep
-- As before, a queued payout the function never picked up is dispatched
-- again. New: an IntaSend payout still 'accepted' after two minutes is
-- dispatched too; the function sees it is not queued and asks IntaSend for
-- its status instead of sending. That is a read, so a stray dispatch is
-- harmless. Asked for a week at most, then it waits for a person.
-- 'unknown' is still never swept: it may already have been paid.
create or replace function app.sweep_payroll_payouts()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pending uuid;
begin
  for pending in
    select id from public.payroll_payouts
     where deleted_at is null
       and (
         (status = 'queued' and updated_at < now() - interval '1 minute')
         or (status = 'accepted' and provider = 'intasend'
             and updated_at < now() - interval '2 minutes'
             and created_at > now() - interval '7 days')
       )
     order by created_at
     limit 50
  loop
    perform app.dispatch_payout(pending);
  end loop;
end;
$$;
