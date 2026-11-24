-- ============================================================================
-- Pack house deliveries and intake QC.
--
-- Rasko delivers stems to a buyer's pack house as an outgrower. The pack house
-- counts what arrived, rejects stems at a primary and a secondary QC check,
-- and returns an intake report (the "Outgrower product quality check &
-- receipt confirmation" sheet): gate pass, delivery note and GRN numbers,
-- arrival temperature, and per variety and stem length the quantity on the
-- delivery note, the quantity received, the two rejection counts and the
-- rejection reason codes. Rasko is paid for accepted stems only.
--
-- Derived, never stored: accepted = received - rejected_primary -
-- rejected_secondary; shortfall = sent - received; ISO week of delivery_date.
--
-- A delivery may raise one order for the accepted stems (order_id), which is
-- how stock leaves through the normal sale path and how the stems get
-- invoiced. Rejected and short stems are booked as wastage by the device in
-- the same step; wastage_recorded_at stops that happening twice.
-- ============================================================================

create table public.packhouse_deliveries (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients (id),
  delivery_date         date not null,
  delivery_note_number  text,
  gatepass_number       text,
  grn_number            text,
  arrival_temp_c        numeric(5,1) check (arrival_temp_c between -10 and 50),
  qc_officer            text,
  packhouse_manager     text,
  status                text not null default 'dispatched'
                        check (status in ('dispatched', 'received', 'cancelled')),
  received_at           timestamptz,
  order_id              uuid references public.orders (id),
  wastage_recorded_at   timestamptz,
  notes                 text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint packhouse_received_has_time check (
    status = 'cancelled' or (status = 'received') = (received_at is not null)
  )
);

create index packhouse_deliveries_client_idx
  on public.packhouse_deliveries (client_id, delivery_date desc) where deleted_at is null;
create index packhouse_deliveries_date_idx
  on public.packhouse_deliveries (delivery_date desc) where deleted_at is null;
create unique index packhouse_deliveries_order_idx
  on public.packhouse_deliveries (order_id) where order_id is not null and deleted_at is null;
create index packhouse_deliveries_sync_idx on public.packhouse_deliveries (updated_at, id);

create trigger packhouse_deliveries_touch_updated_at
  before insert or update on public.packhouse_deliveries
  for each row execute function app.touch_updated_at();

create table public.packhouse_delivery_lines (
  id                  uuid primary key default gen_random_uuid(),
  delivery_id         uuid not null references public.packhouse_deliveries (id),
  product_id          uuid not null references public.products (id),
  stem_length_cm      integer check (stem_length_cm between 1 and 300),
  quantity_sent       numeric(12,3) not null check (quantity_sent > 0),
  quantity_received   numeric(12,3) check (quantity_received >= 0),
  rejected_primary    numeric(12,3) not null default 0 check (rejected_primary >= 0),
  rejected_secondary  numeric(12,3) not null default 0 check (rejected_secondary >= 0),
  -- The pack house's reason codes (1-47 on the standard intake sheet).
  rejection_codes     jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(rejection_codes) = 'array'),
  position            integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint packhouse_rejections_within_received check (
    rejected_primary + rejected_secondary <= coalesce(quantity_received, 0)
  )
);

create index packhouse_delivery_lines_delivery_idx
  on public.packhouse_delivery_lines (delivery_id) where deleted_at is null;
create index packhouse_delivery_lines_product_idx
  on public.packhouse_delivery_lines (product_id) where deleted_at is null;
create index packhouse_delivery_lines_sync_idx
  on public.packhouse_delivery_lines (updated_at, id);

create trigger packhouse_delivery_lines_touch_updated_at
  before insert or update on public.packhouse_delivery_lines
  for each row execute function app.touch_updated_at();

-- created_by / updated_by come from the session (migration 20261105000100).
create trigger packhouse_deliveries_stamp_actor
  before insert or update on public.packhouse_deliveries
  for each row execute function app.stamp_actor();
create trigger packhouse_delivery_lines_stamp_actor
  before insert or update on public.packhouse_delivery_lines
  for each row execute function app.stamp_actor();

-- ------------------------------------------------------------------- RLS
-- Operations: owner and manager record deliveries and intake; the accountant
-- sees them to invoice and reconcile. Sales has no access.

alter table public.packhouse_deliveries enable row level security;
alter table public.packhouse_deliveries force row level security;
alter table public.packhouse_delivery_lines enable row level security;
alter table public.packhouse_delivery_lines force row level security;

create policy packhouse_deliveries_select on public.packhouse_deliveries
  for select to authenticated using (app.can_see_finance());
create policy packhouse_deliveries_write on public.packhouse_deliveries
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy packhouse_delivery_lines_select on public.packhouse_delivery_lines
  for select to authenticated using (app.can_see_finance());
create policy packhouse_delivery_lines_write on public.packhouse_delivery_lines
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

grant select, insert, update on public.packhouse_deliveries,
  public.packhouse_delivery_lines to authenticated;

-- ----------------------------------------------------------------- audit
-- The intake figures decide what Rasko is paid, so a change after receipt
-- is recorded with before and after values.

create trigger packhouse_deliveries_audit_delete
  after update on public.packhouse_deliveries
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function app.write_audit('packhouse.delete');

create trigger packhouse_delivery_lines_audit_intake
  after update on public.packhouse_delivery_lines
  for each row
  when (old.quantity_received is not null and (
    old.quantity_received is distinct from new.quantity_received
    or old.rejected_primary is distinct from new.rejected_primary
    or old.rejected_secondary is distinct from new.rejected_secondary))
  execute function app.write_audit('packhouse.intake_change');
