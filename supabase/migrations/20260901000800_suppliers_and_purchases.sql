-- ============================================================================
-- 0008  suppliers, purchases, purchase_items, supplier_payments.
--
-- Implements: architecture.md §2.12 – §2.15. PRD FR-7.1 – FR-7.6.
-- ============================================================================

create table public.suppliers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(btrim(name)) > 0),
  contact_person     text,
  phone              text check (phone ~ '^\+254[17][0-9]{8}$'),
  email              text,
  payment_terms_days integer not null default 0 check (payment_terms_days >= 0),
  kra_pin            text,
  notes              text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

create index suppliers_sync_idx on public.suppliers (updated_at, id);
create index suppliers_name_trgm_idx on public.suppliers using gin (name gin_trgm_ops);
create trigger suppliers_touch_updated_at
  before insert or update on public.suppliers
  for each row execute function app.touch_updated_at();

alter table public.suppliers enable row level security;
alter table public.suppliers force row level security;

-- ----------------------------------------------------------------- purchases

create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  purchase_number text,
  supplier_id     uuid not null references public.suppliers (id),
  status          text not null default 'ordered'
    check (status in ('ordered', 'received', 'paid', 'cancelled')),
  purchase_date   date not null default current_date,
  due_date        date,
  total_cents     bigint not null default 0 check (total_cents >= 0),
  received_at     timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  -- FR-7.6: purchases affect stock only after receipt confirmation, so the
  -- status and the receipt timestamp must not disagree.
  constraint purchases_received_consistent check (
    (status in ('ordered', 'cancelled') and received_at is null)
    or (status in ('received', 'paid') and received_at is not null)
  ),
  constraint purchases_due_after_date check (due_date is null or due_date >= purchase_date)
);

create unique index purchases_number_key on public.purchases (purchase_number) where purchase_number is not null;
create index purchases_sync_idx     on public.purchases (updated_at, id);
create index purchases_supplier_idx on public.purchases (supplier_id) where deleted_at is null;
create index purchases_due_date_idx on public.purchases (due_date) where status <> 'paid';

create trigger purchases_touch_updated_at
  before insert or update on public.purchases
  for each row execute function app.touch_updated_at();

-- SECURITY DEFINER is required, not decorative: app.document_counters is
-- deliberately ungranted to `authenticated` so no client can read or burn
-- numbers directly. Without this the trigger would run as the caller and every
-- order insert would fail with "permission denied for table document_counters".
create or replace function app.assign_purchase_number()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
begin
  if new.purchase_number is null then
    new.purchase_number := app.allocate_document_number(
      'purchase', 'PUR', extract(year from new.purchase_date)::integer);
  end if;
  return new;
end;
$$;

create trigger purchases_assign_number
  before insert on public.purchases
  for each row execute function app.assign_purchase_number();

alter table public.purchases enable row level security;
alter table public.purchases force row level security;

-- ------------------------------------------------------------ purchase_items

create table public.purchase_items (
  id               uuid primary key default gen_random_uuid(),
  purchase_id      uuid not null references public.purchases (id) on delete restrict,
  product_id       uuid not null references public.products (id),
  quantity         numeric(12,3) not null check (quantity > 0),
  unit_cost_cents  bigint not null check (unit_cost_cents >= 0),
  line_total_cents bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

create index purchase_items_purchase_idx on public.purchase_items (purchase_id) where deleted_at is null;
create index purchase_items_sync_idx     on public.purchase_items (updated_at, id);

create or replace function app.compute_purchase_item_total()
returns trigger language plpgsql as $$
begin
  new.line_total_cents := round(new.quantity * new.unit_cost_cents);
  return new;
end;
$$;

create trigger purchase_items_compute_total
  before insert or update on public.purchase_items
  for each row execute function app.compute_purchase_item_total();

create trigger purchase_items_touch_updated_at
  before insert or update on public.purchase_items
  for each row execute function app.touch_updated_at();

create or replace function app.refresh_purchase_totals()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_purchase_id uuid := coalesce(new.purchase_id, old.purchase_id);
begin
  update public.purchases
  set total_cents = (
    select coalesce(sum(line_total_cents), 0)
    from public.purchase_items
    where purchase_id = v_purchase_id and deleted_at is null
  )
  where id = v_purchase_id;
  return coalesce(new, old);
end;
$$;

create trigger purchase_items_refresh_purchase
  after insert or update or delete on public.purchase_items
  for each row execute function app.refresh_purchase_totals();

alter table public.purchase_items enable row level security;
alter table public.purchase_items force row level security;

-- ------------------------------------- FR-7.3 / FR-7.6: receipt writes stock

-- Fires on the transition into `received`, so an offline receipt and an online
-- one behave identically: whichever device causes the transition, the movements
-- are written once, by the server.
--
-- The unique index on (source_table, source_id, product_id, movement_type)
-- makes this idempotent — a replayed sync cannot double-receive.
create or replace function app.receive_purchase_into_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_update_cost boolean;
begin
  if new.received_at is null or old.received_at is not null then
    return new;
  end if;

  insert into public.stock_movements
    (product_id, movement_type, quantity, unit_cost_cents, source_table, source_id, occurred_at, created_by)
  select pi.product_id, 'purchase_in', pi.quantity, pi.unit_cost_cents,
         'purchases', new.id, new.received_at, new.updated_by
  from public.purchase_items pi
  where pi.purchase_id = new.id and pi.deleted_at is null
  on conflict do nothing;

  -- OPEN QUESTION FR-7.3 (architecture.md §10 #3). Off by default. The movement
  -- always records unit_cost_cents, so valuation is correct either way.
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

create trigger purchases_receive_into_stock
  after update on public.purchases
  for each row execute function app.receive_purchase_into_stock();

-- ---------------------------------------------------------- supplier_payments

-- Append-only, same rules as payments.
create table public.supplier_payments (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references public.purchases (id),
  amount_cents bigint not null check (amount_cents > 0),
  method       text not null check (method in ('mpesa', 'cash', 'bank_transfer', 'cheque')),
  reference    text,
  paid_at      timestamptz not null default now(),

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index supplier_payments_sync_idx     on public.supplier_payments (created_at, id);
create index supplier_payments_purchase_idx on public.supplier_payments (purchase_id);

create trigger supplier_payments_append_only
  before update or delete on public.supplier_payments
  for each row execute function app.block_mutation();

alter table public.supplier_payments enable row level security;
alter table public.supplier_payments force row level security;
