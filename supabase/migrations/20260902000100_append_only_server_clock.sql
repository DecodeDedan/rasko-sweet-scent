-- ============================================================================
-- 0015  The server owns created_at on append-only tables.
--
-- Fixes a real hole found while building the sync engine.
--
-- architecture.md §6.3 makes updated_at server-authoritative, because the pull
-- cursor pages on it and a device with a fast clock would otherwise write rows
-- that every other device's cursor has already passed — rows that then stay
-- invisible forever.
--
-- Append-only tables have no updated_at by design (§2.6), so their cursor pages
-- on created_at instead. But created_at was left client-settable, which reopens
-- exactly the same hole: a phone whose clock is ten minutes fast records a
-- payment, and no other device ever pulls it.
--
-- Device time is still preserved, in the columns that mean "when the thing
-- happened": payments.paid_at, stock_movements.occurred_at,
-- audit_log.occurred_at. Only the sync bookkeeping column is taken away.
-- ============================================================================

create or replace function app.force_created_at()
returns trigger
language plpgsql
as $$
begin
  -- Overwrites whatever the client sent. Not a validation: a correct client and
  -- a lying one are treated identically, which is the point.
  new.created_at := now();
  return new;
end;
$$;

comment on function app.force_created_at() is
  'Makes created_at server-authoritative on append-only tables, whose pull cursor pages on it (architecture.md §6.3).';

create trigger payments_force_created_at
  before insert on public.payments
  for each row execute function app.force_created_at();

create trigger reversals_force_created_at
  before insert on public.reversals
  for each row execute function app.force_created_at();

create trigger stock_movements_force_created_at
  before insert on public.stock_movements
  for each row execute function app.force_created_at();

create trigger supplier_payments_force_created_at
  before insert on public.supplier_payments
  for each row execute function app.force_created_at();

-- audit_log is written only by app.write_audit(), which already sets
-- recorded_at := now(). Its cursor pages on recorded_at, so it needs no trigger.
