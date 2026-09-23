-- ============================================================================
-- 0003  company_settings, tax_config, statutory_rates, categories.
--
-- Implements: architecture.md §2.8, §2.20–2.22. PRD FR-9.1 – FR-9.3, FR-6.1.
-- ============================================================================

-- --------------------------------------------------------- company_settings

create table public.company_settings (
  id           uuid primary key default '00000000-0000-0000-0000-000000000001',
  company_name text not null default 'Rasko Sweet Scent',
  address      text,
  phone        text check (phone ~ '^\+254[17][0-9]{8}$'),
  email        text,
  kra_pin      text,
  logo_url     text,

  -- OPEN (PRD §12.3, architecture.md §10 #4). Must be confirmed before any
  -- invoice is issued: it decides whether VAT appears on customer documents.
  is_vat_registered boolean not null default false,

  -- OPEN (PRD §12.6, architecture.md §10 #6). Printed as payment instructions
  -- on every invoice (FR-5.2); the invoice is wrong until these are real.
  mpesa_paybill text,
  mpesa_till    text,
  bank_details  jsonb,

  -- OPEN (FR-6.6, architecture.md §10 #1). NULL means unanswered. The stock
  -- module must refuse to deduct until it is set — silently defaulting either
  -- way would corrupt inventory in a way nobody would notice for weeks.
  stock_deduction_point text check (stock_deduction_point in ('order_confirmed', 'delivered')),

  -- OPEN (FR-7.3, architecture.md §10 #3).
  update_cost_on_receipt boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint company_settings_singleton check (id = '00000000-0000-0000-0000-000000000001')
);

comment on table public.company_settings is
  'Exactly one row. Feeds the header of every invoice, receipt and payslip (FR-9.1).';
comment on column public.company_settings.stock_deduction_point is
  'OPEN QUESTION FR-6.6. NULL until the client answers. Do not default it.';

create index company_settings_sync_idx on public.company_settings (updated_at, id);
create trigger company_settings_touch_updated_at
  before insert or update on public.company_settings
  for each row execute function app.touch_updated_at();

alter table public.company_settings enable row level security;
alter table public.company_settings force row level security;

-- ---------------------------------------------------------------- tax_config

-- Versioned by effective date for the same reason as statutory rates: an
-- invoice reprinted after a rate change must show the rate it was issued under.
create table public.tax_config (
  id              uuid primary key default gen_random_uuid(),
  is_vat_enabled  boolean not null default false,
  vat_rate_bp     integer not null default 1600 check (vat_rate_bp between 0 and 10000),
  effective_from  date    not null,
  effective_to    date,
  applies_to_category_ids uuid[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint tax_config_period check (effective_to is null or effective_to >= effective_from)
);

comment on column public.tax_config.vat_rate_bp is
  'Basis points: 16% = 1600. Integer arithmetic only — never a float in tax calculations.';
comment on column public.tax_config.applies_to_category_ids is
  'Empty array means every category (FR-9.2).';

create index tax_config_sync_idx on public.tax_config (updated_at, id);
create index tax_config_effective_idx on public.tax_config (effective_from desc);
create trigger tax_config_touch_updated_at
  before insert or update on public.tax_config
  for each row execute function app.touch_updated_at();

alter table public.tax_config enable row level security;
alter table public.tax_config force row level security;

-- ----------------------------------------------------------- statutory_rates

-- FR-9.3. Kenyan statutory rates change by legislation, so they are
-- owner-editable data with effective dates, never constants in code.
--
-- `config` is jsonb because the four schemes have genuinely different shapes:
-- PAYE is banded with a personal relief, the Housing Levy is a flat rate with
-- an optional cap. The application validates each shape on write.
create table public.statutory_rates (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('paye', 'nssf', 'shif', 'housing_levy')),
  effective_from date not null,
  effective_to   date,
  config         jsonb not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint statutory_rates_period check (effective_to is null or effective_to >= effective_from)
);

comment on table public.statutory_rates is
  'PAYE / NSSF / SHIF / Housing Levy, versioned by effective date (FR-9.3). A payroll run snapshots these so historical payslips stay reproducible.';

create unique index statutory_rates_kind_from_key
  on public.statutory_rates (kind, effective_from) where deleted_at is null;
create index statutory_rates_sync_idx on public.statutory_rates (updated_at, id);
create trigger statutory_rates_touch_updated_at
  before insert or update on public.statutory_rates
  for each row execute function app.touch_updated_at();

alter table public.statutory_rates enable row level security;
alter table public.statutory_rates force row level security;

-- ---------------------------------------------------------------- categories

-- A table rather than a CHECK constraint: FR-9.2 attaches VAT applicability to
-- categories, which makes them data the owner edits, not a fixed code list.
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text    not null,
  slug       text    not null,
  is_vatable boolean not null default true,
  position   integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

create unique index categories_slug_key on public.categories (slug) where deleted_at is null;
create unique index categories_name_key on public.categories (lower(name)) where deleted_at is null;
create index categories_sync_idx on public.categories (updated_at, id);
create trigger categories_touch_updated_at
  before insert or update on public.categories
  for each row execute function app.touch_updated_at();

alter table public.categories enable row level security;
alter table public.categories force row level security;
