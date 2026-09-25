-- ============================================================================
-- A payslip paid by M-Pesa cannot also be marked paid by hand (FR-8.7).
--
-- Found in the first sandbox runs (2026-09-25): the app's "Mark paid" wrote
-- paid_at / payment_method / payment_reference over a payslip that
-- app.settle_payroll_payout had just settled, wiping the M-Pesa receipt, and
-- marked another paid while its payout was still with M-Pesa. In production
-- the second is the same salary paid twice: once by hand, once by B2C.
--
-- So, for any caller that is a person (auth.uid() is not null; the service
-- role and the settle trigger are trusted, as everywhere else):
--   * a payslip with an M-Pesa payout in flight or paid keeps its payment
--     fields: M-Pesa records them;
--   * a payslip already recorded as paid keeps them: a payment record is not
--     edited, the same rule as invoice payments (FR-5.5);
--   * a run cannot be marked paid while any of its payouts is still in flight.
-- ============================================================================

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
    raise exception 'This payslip is paid by M-Pesa. It is marked paid when M-Pesa confirms, not by hand.'
      using errcode = 'check_violation';
  end if;

  if old.paid_at is not null then
    raise exception 'This payslip is already recorded as paid; its payment cannot be changed.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger payroll_items_guard_payment
  before update on public.payroll_items
  for each row execute function app.guard_payslip_payment();

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
    raise exception 'M-Pesa is still paying this run. It is marked paid when every payout is confirmed.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger payroll_runs_guard_paid_by_hand
  before update on public.payroll_runs
  for each row execute function app.guard_run_paid_by_hand();
