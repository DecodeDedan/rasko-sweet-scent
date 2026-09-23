-- ============================================================================
-- 0005  products, product_prices, stock_movements.
--
-- Implements: architecture.md §2.9 – §2.11. PRD FR-6.1 – FR-6.8.
-- ============================================================================

create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  sku                  text not null check (length(btrim(sku)) > 0),
  name                 text not null check (length(btrim(name)) > 0),
  category_id          uuid not null references public.categories (id),
  unit                 text not null check (unit in ('stem', 'bundle', 'piece')),
  cost_price_cents     bigint not null default 0 check (cost_price_cents >= 0),
  selling_price_cents  bigint not null default 0 check (selling_price_cents >= 0),
  low_stock_threshold  numeric(12,3) not null default 0 check (low_stock_threshold >= 0),
  is_active            boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

-- There is deliberately NO current_stock column. FR-6.2 makes stock a function
-- of movements; a stored copy would be a second source of truth that two
-- offline devices could each update and neither could merge. Read the
-- product_stock view instead (architecture.md §3.2).
comment on table public.products is
  'Catalogue. Stock is NOT stored here — it is derived from stock_movements (FR-6.2). See the product_stock view.';

create unique index products_sku_key on public.products (upper(sku)) where deleted_at is null;
create index products_sync_idx     on public.products (updated_at, id);
create index products_category_idx on public.products (category_id) where deleted_at is null;
create index products_name_trgm_idx on public.products using gin (name gin_trgm_ops);

create trigger products_touch_updated_at
  before insert or update on public.products
  for each row execute function app.touch_updated_at();

alter table public.products enable row level security;
alter table public.products force row level security;

-- ------------------------------------------------------------ product_prices

-- FR-6.3 is an OPEN question (architecture.md §10 #2). This table exists so
-- that wholesale/retail pricing is additive rather than a migration of every
-- historical order. It stays empty until the client answers.
--
-- Resolution order: matching product_prices row, else products.selling_price_cents.
create table public.product_prices (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id),
  client_type text not null check (client_type in ('individual', 'corporate', 'event_planner')),
  price_cents bigint not null check (price_cents >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

comment on table public.product_prices is
  'OPEN QUESTION FR-6.3. Optional per-client-type price override. Empty until the pricing model is confirmed.';

create unique index product_prices_key on public.product_prices (product_id, client_type) where deleted_at is null;
create index product_prices_sync_idx on public.product_prices (updated_at, id);

create trigger product_prices_touch_updated_at
  before insert or update on public.product_prices
  for each row execute function app.touch_updated_at();

alter table public.product_prices enable row level security;
alter table public.product_prices force row level security;

-- ----------------------------------------------------------- stock_movements

-- APPEND-ONLY (architecture.md §2.11, §5.4).
--
-- `quantity` is signed: positive for purchase_in and return, negative for sale
-- and wastage, either for adjustment. That makes current stock a plain
-- sum(quantity) — one index-only aggregate rather than a CASE over movement
-- types. Negative results are allowed and flagged, not blocked (FR-6.7).
create table public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id),
  movement_type  text not null check (movement_type in ('purchase_in', 'sale', 'wastage', 'adjustment', 'return')),
  quantity       numeric(12,3) not null check (quantity <> 0),
  unit_cost_cents bigint check (unit_cost_cents >= 0),
  source_table   text not null default 'manual' check (source_table in ('orders', 'purchases', 'manual')),
  source_id      uuid,
  reason         text,
  occurred_at    timestamptz not null default now(),

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),

  -- The sign of the quantity must agree with the movement type, so a bad client
  -- cannot record a "sale" that increases stock.
  constraint stock_movements_sign check (
    (movement_type in ('purchase_in', 'return') and quantity > 0)
    or (movement_type in ('sale', 'wastage') and quantity < 0)
    or (movement_type = 'adjustment')
  ),

  -- FR-6.2 / FR-6.5: wastage and adjustment are the two types a human chooses
  -- freely, so both must say why. Without this the wastage report is unusable.
  constraint stock_movements_reason_required check (
    movement_type not in ('wastage', 'adjustment')
    or (reason is not null and length(btrim(reason)) > 0)
  ),

  constraint stock_movements_source check (
    (source_table = 'manual' and source_id is null)
    or (source_table <> 'manual' and source_id is not null)
  )
);

comment on table public.stock_movements is
  'Append-only ledger. Current stock = sum(quantity). A wrong movement is corrected by an opposing adjustment, never by editing (architecture.md §2.11).';

-- This is what makes stock deduction idempotent: replaying a sync, or
-- confirming an order twice, cannot double-deduct (T6).
create unique index stock_movements_source_idx
  on public.stock_movements (source_table, source_id, product_id, movement_type)
  where source_table <> 'manual';

create index stock_movements_sync_idx    on public.stock_movements (created_at, id);
create index stock_movements_product_idx on public.stock_movements (product_id) include (quantity);
create index stock_movements_type_idx    on public.stock_movements (movement_type, occurred_at desc);

create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function app.block_mutation();

alter table public.stock_movements enable row level security;
alter table public.stock_movements force row level security;
