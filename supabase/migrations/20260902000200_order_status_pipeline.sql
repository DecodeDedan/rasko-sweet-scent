-- ============================================================================
-- 0016  Order status pipeline, enforced server-side.
--
-- Implements: PRD FR-4.2 — draft -> confirmed -> in production -> ready ->
-- delivered -> closed, with cancellation allowed any time before closed.
--
-- Migration 0013 already restricts WHO may cancel (manager or owner). This adds
-- the other half: WHICH transitions are legal at all. Without it a client could
-- move an order straight from draft to delivered, skipping production, and the
-- delivery schedule would quietly describe work nobody did.
-- ============================================================================

create or replace function app.guard_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed text[];
begin
  if new.status = old.status then
    return new;
  end if;

  -- A null caller is postgres or service_role — a migration, the SQL editor or a
  -- backend repair. Those are trusted and must be able to set any state, the
  -- same escape hatch every other guard uses.
  if auth.uid() is null then
    return new;
  end if;

  v_allowed := case old.status
    when 'draft'         then array['confirmed', 'cancelled']
    when 'confirmed'     then array['in_production', 'cancelled']
    when 'in_production' then array['ready', 'cancelled']
    when 'ready'         then array['delivered', 'cancelled']
    when 'delivered'     then array['closed', 'cancelled']
    -- Terminal. A closed order is settled history; a cancelled one is not
    -- resurrected, a new order is raised instead.
    when 'closed'        then array[]::text[]
    when 'cancelled'     then array[]::text[]
    else array[]::text[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception
      'An order cannot go from % to %. Allowed from %: %.',
      old.status, new.status, old.status,
      coalesce(nullif(array_to_string(v_allowed, ', '), ''), 'nothing — this state is final')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app.guard_order_transition() is
  'Rejects illegal order status transitions (FR-4.2). Complements orders_guard_cancel, which restricts who may cancel.';

create trigger orders_guard_transition
  before update on public.orders
  for each row execute function app.guard_order_transition();

-- FR-4.4: an order converts to exactly one invoice. Without this, clicking
-- "Create invoice" twice — or a replayed sync — bills the client twice.
create unique index invoices_one_per_order
  on public.invoices (order_id)
  where order_id is not null and deleted_at is null and status <> 'voided';
