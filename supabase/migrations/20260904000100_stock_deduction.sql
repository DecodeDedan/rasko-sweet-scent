-- ============================================================================
-- 0017  Sale deduction from orders.
--
-- Implements: PRD FR-6.2 (every stock change writes a movement) and FR-6.6
-- (stock deducted at order confirmation OR delivery).
--
-- ## The FR-6.6 decision
--
-- PRD §12 question 4 is not yet answered by the client. The chosen default is
-- **delivery**, recorded in `company_settings.stock_deduction_point` so it is a
-- one-value change, not a code change. The reasoning:
--
--   * Current stock then means what is physically in the shop — the only figure
--     a physical count can verify, and PRD §2 makes "month-end stock variance
--     explainable from system records" a success metric.
--   * Fresh flowers are bought close to the delivery date. Deducting when an
--     event is confirmed two weeks out would remove stock not yet purchased and
--     drive the ledger negative for no real reason; FR-6.7 shows negative stock
--     is already a known pain.
--   * Walk-in trade keeps seeing true availability rather than shelves the
--     system believes are empty.
--   * An order cancelled before delivery never deducted, so nothing has to be
--     unwound — which removes an ambiguity that deducting at confirmation
--     would create.
--
-- The trade-off is that stock is not reserved, so confirmed orders can be
-- oversold. Commitments remain visible in the upcoming-deliveries view.
--
-- CLIENT MUST CONFIRM. To switch:
--   update company_settings set stock_deduction_point = 'order_confirmed';
--
-- Server-side because architecture.md §6.6 requires it: the movement must be
-- written exactly once, whichever device causes the transition, and an offline
-- device cannot know whether another device already did it.
-- ============================================================================

-- ## Why this is driven from both tables, and not by a status transition
--
-- The obvious shape — an AFTER UPDATE trigger watching for the transition into
-- the deduction point — is wrong for an offline-first system, in two ways:
--
--   1. An order created AND delivered on a device with no connection arrives at
--      the server as a single INSERT that is already `delivered`. There is no
--      UPDATE, so a transition trigger never fires and the stock is never
--      deducted. That is not an edge case; it is the ordinary path for a
--      counter sale entered on a phone.
--   2. The push sends `orders` before `order_items`, so when the order lands its
--      lines may not exist yet. A trigger that reads them at that moment finds
--      nothing and, being idempotent, never tries again.
--
-- So the rule is expressed as a state, not an event: "an order at or past the
-- deduction point has a sale movement for each of its catalogue lines." It is
-- re-evaluated whenever either side changes, and the unique index makes every
-- re-evaluation a no-op once the movements exist.

create or replace function app.sync_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_point  text;
  v_status text;
  v_at_or_past boolean;
begin
  select stock_deduction_point into v_point from public.company_settings limit 1;
  if v_point is null then
    return;
  end if;

  select status into v_status from public.orders where id = p_order_id;
  if v_status is null then
    return;
  end if;

  -- "At or past", not "equal to": an order can arrive already closed, having
  -- passed the deduction point while the device was offline.
  v_at_or_past := case v_point
    when 'order_confirmed' then v_status in ('confirmed', 'in_production', 'ready', 'delivered', 'closed')
    when 'delivered'       then v_status in ('delivered', 'closed')
    else false
  end;

  if not v_at_or_past then
    return;
  end if;

  insert into public.stock_movements
    (product_id, movement_type, quantity, unit_cost_cents, source_table, source_id, occurred_at, created_by)
  select oi.product_id,
         'sale',
         -oi.quantity,
         p.cost_price_cents,
         'orders',
         o.id,
         now(),
         coalesce(o.updated_by, o.created_by)
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  join public.products p on p.id = oi.product_id
  where o.id = p_order_id
    and oi.deleted_at is null
    and oi.product_id is not null
    and oi.quantity > 0
  on conflict do nothing;
end;
$$;

comment on function app.sync_order_stock(uuid) is
  'Ensures an order at or past company_settings.stock_deduction_point has its sale movements. Idempotent; safe to call from either side (FR-6.6).';

create or replace function app.deduct_stock_for_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.sync_order_stock(new.id);
  return new;
end;
$$;

create trigger orders_deduct_stock
  after insert or update on public.orders
  for each row execute function app.deduct_stock_for_order();

-- A line arriving after its order — routine, because pushes go orders first.
create or replace function app.deduct_stock_for_order_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.sync_order_stock(new.order_id);
  return new;
end;
$$;

create trigger order_items_deduct_stock
  after insert or update on public.order_items
  for each row execute function app.deduct_stock_for_order_item();

-- ----------------------------------------------------------------------------
-- Goods coming back after they were already deducted.
--
-- With deduction at delivery this is narrow and unambiguous: the only way to
-- reach it is delivered -> cancelled, which means the goods physically came
-- back. A `return` movement restores them, and the reason records why.
--
-- If the client switches to deduction at confirmation, this needs revisiting:
-- cancelling a confirmed-but-undelivered order would then mean the flowers were
-- never sent, which may be a return or may be wastage. That is a business
-- question, not a technical one.
-- ----------------------------------------------------------------------------
create or replace function app.return_stock_for_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'cancelled' or old.status is not distinct from 'cancelled' then
    return new;
  end if;

  -- Only reverse what was actually deducted for this order.
  insert into public.stock_movements
    (product_id, movement_type, quantity, unit_cost_cents, source_table, source_id, occurred_at, reason, created_by)
  select m.product_id,
         'return',
         -m.quantity,
         m.unit_cost_cents,
         'orders',
         new.id,
         now(),
         coalesce(new.cancellation_reason, 'Order cancelled'),
         coalesce(new.updated_by, new.created_by)
  from public.stock_movements m
  where m.source_table = 'orders'
    and m.source_id = new.id
    and m.movement_type = 'sale'
  on conflict do nothing;

  return new;
end;
$$;

create trigger orders_return_stock
  after update on public.orders
  for each row execute function app.return_stock_for_cancelled_order();

-- The recommended default, so the module works out of the box on a fresh
-- database. Change it here or in Settings once the client confirms.
update public.company_settings
set stock_deduction_point = 'delivered'
where stock_deduction_point is null;
