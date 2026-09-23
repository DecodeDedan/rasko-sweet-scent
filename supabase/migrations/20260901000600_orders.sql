-- ============================================================================
-- 0006  orders, order_items.
--
-- Implements: architecture.md §2.3, §2.4. PRD FR-4.1 – FR-4.7.
-- ============================================================================

create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  order_number text,
  client_id    uuid references public.clients (id),
  is_walk_in   boolean not null default false,
  status       text not null default 'draft'
    check (status in ('draft', 'confirmed', 'in_production', 'ready', 'delivered', 'closed', 'cancelled')),
  order_type   text not null default 'standard' check (order_type in ('standard', 'event')),

  subtotal_cents  bigint not null default 0,
  discount_cents  bigint not null default 0 check (discount_cents >= 0),
  total_cents     bigint not null default 0,

  delivery_at      timestamptz,
  delivery_address text,

  event_date        date,
  event_venue       text,
  event_setup_notes text,

  notes    text,
  taken_by uuid not null references public.profiles (id),

  confirmed_at timestamptz,
  delivered_at timestamptz,

  cancelled_at        timestamptz,
  cancelled_by        uuid references public.profiles (id),
  cancellation_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  -- Keeps the walk-in flag and the client reference honest in one direction
  -- only: a walk-in has no client, and a client order is not a walk-in.
  constraint orders_walk_in_consistent check (is_walk_in = (client_id is null)),

  -- FR-4.2: cancelling requires a reason, so the audit trail explains itself.
  constraint orders_cancellation_consistent check (
    (status <> 'cancelled' and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null
        and cancellation_reason is not null and length(btrim(cancellation_reason)) > 0)
  )
);

comment on column public.orders.order_number is
  'ORD-YYYY-NNNN, server-assigned. Unlike invoices this carries no gap-free obligation (FR-5.1 applies to invoices only).';
comment on column public.orders.taken_by is
  'Who took the order, which is not necessarily who typed it in (FR-4.1).';
comment on column public.orders.total_cents is
  'Cached aggregate of order_items, maintained by trigger. Unlike invoice balance this IS stored, because line items are owned by the same device rather than arriving independently.';

create unique index orders_number_key on public.orders (order_number) where order_number is not null;
create index orders_sync_idx       on public.orders (updated_at, id);
create index orders_client_idx     on public.orders (client_id) where deleted_at is null;
create index orders_created_by_idx on public.orders (created_by);
create index orders_taken_by_idx   on public.orders (taken_by);
create index orders_status_idx     on public.orders (status) where deleted_at is null;
create index orders_delivery_idx   on public.orders (delivery_at)
  where status not in ('closed', 'cancelled') and deleted_at is null;

create trigger orders_touch_updated_at
  before insert or update on public.orders
  for each row execute function app.touch_updated_at();

alter table public.orders enable row level security;
alter table public.orders force row level security;

-- ORD numbers are allocated by the same transactional counter as invoices.
-- SECURITY DEFINER is required, not decorative: app.document_counters is
-- deliberately ungranted to `authenticated` so no client can read or burn
-- numbers directly. Without this the trigger would run as the caller and every
-- order insert would fail with "permission denied for table document_counters".
create or replace function app.assign_order_number()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
begin
  if new.order_number is null then
    new.order_number := app.allocate_document_number(
      'order', 'ORD', extract(year from coalesce(new.created_at, now()))::integer);
  end if;
  return new;
end;
$$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function app.assign_order_number();

-- --------------------------------------------------------------- order_items

-- description and unit_price_cents are SNAPSHOTS, not lookups. FR-5.2 requires
-- an invoice PDF to be reproducible years later, and products are mutable: a
-- price change in 2027 must not silently rewrite a 2026 order.
create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete restrict,
  product_id       uuid references public.products (id),
  description      text not null check (length(btrim(description)) > 0),
  quantity         numeric(12,3) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_cents   bigint not null default 0 check (discount_cents >= 0),
  line_total_cents bigint not null default 0,
  position         integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

comment on column public.order_items.description is
  'Free text for a custom arrangement, or a snapshot of the product name. Never resolved from products at read time.';

create index order_items_order_idx on public.order_items (order_id) where deleted_at is null;
create index order_items_sync_idx  on public.order_items (updated_at, id);

-- Line total is computed server-side so client and server cannot disagree.
create or replace function app.compute_order_item_total()
returns trigger language plpgsql as $$
begin
  new.line_total_cents := round(new.quantity * new.unit_price_cents) - new.discount_cents;
  return new;
end;
$$;

create trigger order_items_compute_total
  before insert or update on public.order_items
  for each row execute function app.compute_order_item_total();

create trigger order_items_touch_updated_at
  before insert or update on public.order_items
  for each row execute function app.touch_updated_at();

-- Roll the line items up into the parent order.
create or replace function app.refresh_order_totals()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_subtotal bigint;
begin
  select coalesce(sum(line_total_cents), 0) into v_subtotal
  from public.order_items
  where order_id = v_order_id and deleted_at is null;

  update public.orders
  set subtotal_cents = v_subtotal,
      total_cents    = v_subtotal - discount_cents
  where id = v_order_id;

  return coalesce(new, old);
end;
$$;

create trigger order_items_refresh_order
  after insert or update or delete on public.order_items
  for each row execute function app.refresh_order_totals();

alter table public.order_items enable row level security;
alter table public.order_items force row level security;
