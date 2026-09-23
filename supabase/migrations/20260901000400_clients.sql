-- ============================================================================
-- 0004  clients.
--
-- Implements: architecture.md §2.2. PRD FR-3.1 – FR-3.6.
-- ============================================================================

create table public.clients (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) > 0),
  client_type       text not null check (client_type in ('individual', 'corporate', 'event_planner')),
  phone             text check (phone ~ '^\+254[17][0-9]{8}$'),
  email             text,
  kra_pin           text,
  address           text,
  credit_terms_days integer not null default 0 check (credit_terms_days >= 0),
  notes             text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

comment on table public.clients is
  'People and businesses sold to. Walk-in sales do not create a row here — see orders.is_walk_in (FR-3.6).';
comment on column public.clients.created_by is
  'Load-bearing: this is the RLS predicate that scopes sales users to their own clients (FR-3.4).';
comment on column public.clients.credit_terms_days is
  'Drives invoice due dates and therefore the receivables aging buckets (FR-2.4).';

create index clients_sync_idx      on public.clients (updated_at, id);
create index clients_created_by_idx on public.clients (created_by);
create index clients_phone_idx     on public.clients (phone) where deleted_at is null;
create index clients_type_idx      on public.clients (client_type) where deleted_at is null;
create index clients_name_trgm_idx on public.clients using gin (name gin_trgm_ops);

create trigger clients_touch_updated_at
  before insert or update on public.clients
  for each row execute function app.touch_updated_at();

alter table public.clients enable row level security;
alter table public.clients force row level security;

-- FR-3.5 (block soft-delete while invoices are unpaid) is enforced by a trigger
-- defined in migration 0007, once invoices and payments exist. It has to be a
-- server-side check: an offline device cannot see invoices raised elsewhere.
