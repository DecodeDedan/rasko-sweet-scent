-- ============================================================================
-- Salary payouts by M-Pesa B2C (Daraja).
--
-- Scope note: PRD §4 leaves "Daraja auto-reconciliation" of incoming payments
-- out of v1. Paying salaries out is a separate, owner-requested extension
-- (2026-09-27), recorded in docs/PROGRESS.md for client sign-off.
--
-- Flow, the same offline-first shape as client email (migration 20260925000100):
--   1. The owner asks to pay an approved run. The device inserts one row here
--      per payslip line, naming only the line. It syncs up.
--   2. The insert trigger below fills in everything that decides the money
--      itself: the amount (net pay, whole shillings, rounded down), the phone,
--      the employee. A device cannot choose who is paid or how much.
--   3. pg_net asks the mpesa-b2c function to send it; Safaricom answers later
--      on mpesa-b2c-result, which settles the row and marks the payslip paid.
--
-- NEVER PAY TWICE
--   * one live payout per payslip line: a partial unique index over the
--     statuses that mean "money may be moving" (queued, sending, accepted,
--     unknown, paid). A failed payout may be retried; nothing else may.
--   * the device pushes this table insert-only (tables.ts pushInsertOnly), so
--     a retried push cannot reset a row the server has moved on;
--   * the function claims a row with one conditional UPDATE;
--   * a request that may have reached Safaricom but got no answer is 'unknown',
--     never retried automatically: someone checks the M-Pesa statement first.
-- ============================================================================

create table public.payroll_payouts (
  id              uuid primary key default gen_random_uuid(),
  payroll_run_id  uuid not null references public.payroll_runs (id),
  payroll_item_id uuid not null references public.payroll_items (id),
  employee_id     uuid references public.employees (id),

  -- Server-derived (app.prepare_payroll_payout). Whole shillings, stored as cents.
  amount_cents    bigint check (amount_cents is null or (amount_cents > 0 and amount_cents % 100 = 0)),
  remainder_cents bigint not null default 0 check (remainder_cents between 0 and 99),
  msisdn          text check (msisdn is null or msisdn ~ '^254[17][0-9]{8}$'),

  status text not null default 'queued'
    check (status in ('queued', 'sending', 'accepted', 'paid', 'failed', 'unknown')),
  attempts        integer not null default 0 check (attempts >= 0),
  conversation_id text,
  mpesa_receipt   text,
  result_code     text,
  result_desc     text check (result_desc is null or length(result_desc) <= 500),
  recipient_name  text,
  settled_at      timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint payroll_payouts_paid_has_receipt check (status <> 'paid' or mpesa_receipt is not null)
);

comment on table public.payroll_payouts is
  'Salary payouts by M-Pesa B2C. Amount and phone are set by the server, never the device. See migration 20260927000100.';

create unique index payroll_payouts_one_live_per_item
  on public.payroll_payouts (payroll_item_id)
  where status in ('queued', 'sending', 'accepted', 'unknown', 'paid') and deleted_at is null;
create index payroll_payouts_run_idx on public.payroll_payouts (payroll_run_id);
create index payroll_payouts_sync_idx on public.payroll_payouts (updated_at, id);
create index payroll_payouts_queued_idx on public.payroll_payouts (created_at) where status = 'queued';

create trigger payroll_payouts_touch_updated_at
  before insert or update on public.payroll_payouts
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------- the money rules

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
  phone_digits text;
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
  if not found or coalesce(emp.payment_method, '') <> 'mpesa' then
    raise exception 'This employee is paid by bank, not M-Pesa.' using errcode = 'check_violation';
  end if;

  phone_digits := regexp_replace(coalesce(emp.phone, ''), '^\+', '');
  if phone_digits !~ '^254[17][0-9]{8}$' then
    raise exception 'The employee has no valid M-Pesa number.' using errcode = 'check_violation';
  end if;
  if floor(item.net_pay_cents / 100.0) < 10 then
    raise exception 'Net pay is below the M-Pesa minimum.' using errcode = 'check_violation';
  end if;
  if floor(item.net_pay_cents / 100.0) > 250000 then
    raise exception 'Net pay is above the M-Pesa limit; pay by bank.' using errcode = 'check_violation';
  end if;

  -- Whatever the device sent, these come from the approved run.
  new.employee_id     := item.employee_id;
  new.amount_cents    := floor(item.net_pay_cents / 100.0)::bigint * 100;
  new.remainder_cents := item.net_pay_cents - new.amount_cents;
  new.msisdn          := phone_digits;
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

create trigger payroll_payouts_prepare
  before insert on public.payroll_payouts
  for each row execute function app.prepare_payroll_payout();

-- A paid payout settles its payslip line (FR-8.7) with the M-Pesa receipt,
-- and the run once every line is paid.
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
           payment_method = 'mpesa',
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

create trigger payroll_payouts_settle
  after update on public.payroll_payouts
  for each row execute function app.settle_payroll_payout();

create trigger payroll_payouts_audit
  after insert on public.payroll_payouts
  for each row execute function app.write_audit('payroll.payout_request');

-- ------------------------------------------------------------------- RLS

alter table public.payroll_payouts enable row level security;
alter table public.payroll_payouts force row level security;

create policy payroll_payouts_insert on public.payroll_payouts
  for insert to authenticated with check (app.is_owner());

-- FR-8.8: owner full, manager read-only, accountant prepares; sales never.
create policy payroll_payouts_select on public.payroll_payouts
  for select to authenticated using (app.can_see_finance());

grant select, insert on public.payroll_payouts to authenticated;

-- -------------------------------------------------------------- dispatch

-- Where the mpesa-b2c function lives: a row, not a constant, because it
-- differs per environment. supabase/seeds/local.sql sets it locally; hosted is
-- one statement in docs/mpesa-setup.md. While null, payouts wait queued.
create table app.payout_dispatch (
  id           boolean primary key default true check (id),
  function_url text
);
insert into app.payout_dispatch (id, function_url) values (true, null);
revoke all on app.payout_dispatch from public;

create or replace function app.dispatch_payout(payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  target text;
begin
  select function_url into target from app.payout_dispatch;
  if target is null then
    return;
  end if;
  -- Only the id travels. The function re-reads the row and sends it only if
  -- it can claim it from 'queued', so a forged call can do nothing new.
  perform net.http_post(
    url     := target,
    body    := jsonb_build_object('id', payout_id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
end;
$$;

create or replace function app.dispatch_new_payout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.dispatch_payout(new.id);
  return new;
end;
$$;

create trigger payroll_payouts_dispatch
  after insert on public.payroll_payouts
  for each row execute function app.dispatch_new_payout();

-- A queued payout the function never picked up (down, or not configured when
-- it arrived) is dispatched again. 'unknown' is deliberately not swept: it may
-- already have been paid.
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
     where status = 'queued' and updated_at < now() - interval '1 minute'
     order by created_at
     limit 50
  loop
    perform app.dispatch_payout(pending);
  end loop;
end;
$$;

select cron.schedule('sweep-payroll-payouts', '* * * * *', 'select app.sweep_payroll_payouts()');
