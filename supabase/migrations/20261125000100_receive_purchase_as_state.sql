-- ============================================================================
-- Receiving a purchase into stock is a state, not an event.
--
-- The trigger fired only on an UPDATE that set received_at. A purchase created
-- and received on a device before it synced reaches the server as one INSERT
-- already received, and its lines are pushed after it (purchases precede
-- purchase_items in the push order), so no stock-in was ever written. Found
-- by the 2026-11-25 live test: a received TEST purchase with no movements.
--
-- Same rule as app.sync_order_stock: "a received purchase has a purchase_in
-- movement per line", re-asserted from both sides, idempotent through the
-- unique index on (source_table, source_id, product_id, movement_type).
-- ============================================================================

create or replace function app.receive_purchase_into_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_update_cost boolean;
begin
  if new.received_at is null or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.received_at is not null then
    return new;
  end if;

  insert into public.stock_movements
    (product_id, movement_type, quantity, unit_cost_cents, source_table, source_id, occurred_at, created_by)
  select pi.product_id, 'purchase_in', pi.quantity, pi.unit_cost_cents,
         'purchases', new.id, new.received_at, new.updated_by
  from public.purchase_items pi
  where pi.purchase_id = new.id and pi.deleted_at is null
  on conflict do nothing;

  -- OPEN QUESTION FR-7.3 (architecture.md §10 #3). Off by default.
  select coalesce(update_cost_on_receipt, false) into v_update_cost
  from public.company_settings limit 1;

  if v_update_cost then
    update public.products p
    set cost_price_cents = pi.unit_cost_cents
    from public.purchase_items pi
    where pi.purchase_id = new.id and pi.product_id = p.id and pi.deleted_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists purchases_receive_into_stock on public.purchases;
create trigger purchases_receive_into_stock
  after insert or update on public.purchases
  for each row execute function app.receive_purchase_into_stock();

-- A line that arrives after its purchase was already received.
create or replace function app.receive_purchase_line_into_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  select * into v_purchase from public.purchases where id = new.purchase_id;
  if not found or v_purchase.received_at is null or v_purchase.deleted_at is not null then
    return new;
  end if;

  insert into public.stock_movements
    (product_id, movement_type, quantity, unit_cost_cents, source_table, source_id, occurred_at, created_by)
  values (new.product_id, 'purchase_in', new.quantity, new.unit_cost_cents,
          'purchases', v_purchase.id, v_purchase.received_at, new.updated_by)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists purchase_items_receive_into_stock on public.purchase_items;
create trigger purchase_items_receive_into_stock
  after insert on public.purchase_items
  for each row execute function app.receive_purchase_line_into_stock();

-- Backfill: every received purchase missing a line's stock-in.
insert into public.stock_movements
  (product_id, movement_type, quantity, unit_cost_cents, source_table, source_id, occurred_at, created_by)
select pi.product_id, 'purchase_in', pi.quantity, pi.unit_cost_cents,
       'purchases', p.id, p.received_at, p.updated_by
from public.purchases p
join public.purchase_items pi on pi.purchase_id = p.id and pi.deleted_at is null
where p.received_at is not null and p.deleted_at is null
on conflict do nothing;
