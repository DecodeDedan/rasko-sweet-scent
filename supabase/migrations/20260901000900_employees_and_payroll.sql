-- ============================================================================
-- 0009  employees, advances, payroll_runs, payroll_items.
--
-- Implements: architecture.md §2.16 – §2.19. PRD FR-8.1 – FR-8.9.
--
-- This module holds personal data under the Data Protection Act 2019 (PRD §9).
-- Sales never sees any of it; the RLS policies in 0013 enforce that.
-- ============================================================================

create table public.employees (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid references public.profiles (id),
  full_name      text not null check (length(btrim(full_name)) > 0),
  national_id    text not null,
  kra_pin        text,
  nssf_number    text,
  shif_number    text,
  phone          text check (phone ~ '^\+254[17][0-9]{8}$'),
  position       text,
  salary_type    text not null check (salary_type in ('monthly', 'daily')),
  basic_pay_cents bigint not null default 0 check (basic_pay_cents >= 0),

  -- Allowances are configurable per employee (FR-8.2), so a fixed column set
  -- would not survive contact with the business.
  -- Shape: [{"code":"housing","label":"Housing","amount_cents":500000}]
  allowances jsonb not null default '[]'::jsonb,

  payment_method  text check (payment_method in ('mpesa', 'bank')),
  payment_details jsonb,
  is_active       boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint employees_allowances_is_array check (jsonb_typeof(allowances) = 'array')
);

comment on table public.employees is
  'Personal data under the Data Protection Act 2019. Readable by owner, manager and accountant only; never by sales (PRD §3.1, FR-8.8).';
comment on column public.employees.profile_id is
  'An employee is not necessarily a system user, so this is nullable.';
comment on column public.employees.basic_pay_cents is
  'Monthly salary or daily rate, per salary_type.';

create unique index employees_national_id_key on public.employees (national_id) where deleted_at is null;
create unique index employees_profile_key     on public.employees (profile_id) where profile_id is not null and deleted_at is null;
create index employees_sync_idx  on public.employees (updated_at, id);
create index employees_active_idx on public.employees (is_active) where deleted_at is null;

create trigger employees_touch_updated_at
  before insert or update on public.employees
  for each row execute function app.touch_updated_at();

alter table public.employees enable row level security;
alter table public.employees force row level security;

-- ------------------------------------------------------------------ advances

create table public.advances (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id),
  amount_cents bigint not null check (amount_cents > 0),
  requested_at timestamptz not null default now(),
  requested_by uuid references public.profiles (id),
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'recovered')),
  approved_at  timestamptz,
  approved_by  uuid references public.profiles (id),
  recovered_in_run_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint advances_approval_consistent check (
    (status in ('pending', 'rejected') and approved_at is null)
    or (status in ('approved', 'recovered') and approved_at is not null and approved_by is not null)
  )
);

comment on column public.advances.recovered_in_run_id is
  'Set when the advance is deducted. This is what stops it being deducted twice (FR-8.3).';

create index advances_sync_idx     on public.advances (updated_at, id);
create index advances_employee_idx on public.advances (employee_id) where deleted_at is null;
create index advances_status_idx   on public.advances (status) where deleted_at is null;

create trigger advances_touch_updated_at
  before insert or update on public.advances
  for each row execute function app.touch_updated_at();

alter table public.advances enable row level security;
alter table public.advances force row level security;

-- -------------------------------------------------------------- payroll_runs

create table public.payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  period_year  integer not null check (period_year between 2000 and 2999),
  period_month integer not null check (period_month between 1 and 12),
  status       text not null default 'draft'
    check (status in ('draft', 'prepared', 'approved', 'paid', 'cancelled')),
  prepared_at  timestamptz,
  prepared_by  uuid references public.profiles (id),
  approved_at  timestamptz,
  approved_by  uuid references public.profiles (id),

  -- The most important column in the payroll module. PAYE bands, NSSF, SHIF and
  -- the Housing Levy change by legislation (FR-9.3). Without a snapshot,
  -- reprinting an eight-month-old payslip would recompute it against today's
  -- rates and produce a different, wrong figure.
  rates_snapshot jsonb not null default '{}'::jsonb,
  totals         jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  -- FR-8.5: approval is owner-only, and an approved run must record who and when.
  constraint payroll_runs_approval_consistent check (
    (status in ('draft', 'prepared', 'cancelled') and approved_at is null)
    or (status in ('approved', 'paid') and approved_at is not null and approved_by is not null)
  )
);

comment on column public.payroll_runs.rates_snapshot is
  'The full statutory rate set used, copied in at preparation. This is what makes historical payslips reproducible byte-for-byte.';

create unique index payroll_runs_period_key
  on public.payroll_runs (period_year, period_month) where deleted_at is null;
create index payroll_runs_sync_idx on public.payroll_runs (updated_at, id);

create trigger payroll_runs_touch_updated_at
  before insert or update on public.payroll_runs
  for each row execute function app.touch_updated_at();

alter table public.payroll_runs enable row level security;
alter table public.payroll_runs force row level security;

alter table public.advances
  add constraint advances_recovered_in_run_fkey
  foreign key (recovered_in_run_id) references public.payroll_runs (id);

-- ------------------------------------------------------------- payroll_items

-- Every component is stored rather than recomputed on read. Payroll arithmetic
-- must be auditable by the client's accountant against a paper computation
-- (PRD §11), which means the numbers on the payslip are the numbers in the
-- database.
create table public.payroll_items (
  id              uuid primary key default gen_random_uuid(),
  payroll_run_id  uuid not null references public.payroll_runs (id) on delete restrict,
  employee_id     uuid not null references public.employees (id),

  -- Snapshot: payslips must not change when the employee record does.
  employee_snapshot jsonb not null default '{}'::jsonb,

  days_worked      numeric(5,2) check (days_worked >= 0),
  basic_pay_cents  bigint not null default 0 check (basic_pay_cents >= 0),
  allowances       jsonb  not null default '[]'::jsonb,
  gross_cents      bigint not null default 0 check (gross_cents >= 0),

  paye_cents          bigint not null default 0 check (paye_cents >= 0),
  nssf_cents          bigint not null default 0 check (nssf_cents >= 0),
  shif_cents          bigint not null default 0 check (shif_cents >= 0),
  housing_levy_cents  bigint not null default 0 check (housing_levy_cents >= 0),
  advance_deduction_cents bigint not null default 0 check (advance_deduction_cents >= 0),
  other_deductions    jsonb  not null default '[]'::jsonb,
  net_pay_cents       bigint not null default 0,

  paid_at           timestamptz,
  payment_method    text check (payment_method in ('mpesa', 'bank')),
  payment_reference text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

create unique index payroll_items_run_employee_key
  on public.payroll_items (payroll_run_id, employee_id) where deleted_at is null;
create index payroll_items_run_idx      on public.payroll_items (payroll_run_id);
create index payroll_items_employee_idx on public.payroll_items (employee_id);
create index payroll_items_sync_idx     on public.payroll_items (updated_at, id);

create trigger payroll_items_touch_updated_at
  before insert or update on public.payroll_items
  for each row execute function app.touch_updated_at();

alter table public.payroll_items enable row level security;
alter table public.payroll_items force row level security;

-- FR-8.5: approval is owner-only. Enforced by trigger as well as by policy.
create or replace function app.guard_payroll_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() null means an admin/service_role context, not an app request.
  if auth.uid() is not null
     and new.status in ('approved', 'paid') and old.status not in ('approved', 'paid')
     and coalesce(app.current_user_role(), '') <> 'owner'
  then
    raise exception 'Only the owner may approve a payroll run (FR-8.5).'
      using errcode = 'insufficient_privilege';
  end if;

  -- An approved run is frozen. Correcting a rate means a new run, not an edit,
  -- so historical payslips stay reproducible (architecture.md §11 #4).
  if old.status in ('approved', 'paid')
     and new.rates_snapshot is distinct from old.rates_snapshot
  then
    raise exception 'The rate snapshot of an approved payroll run cannot be changed.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger payroll_runs_guard_approval
  before update on public.payroll_runs
  for each row execute function app.guard_payroll_approval();

-- FR-8.3: only the owner approves an advance.
create or replace function app.guard_advance_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and new.status = 'approved' and old.status <> 'approved'
     and coalesce(app.current_user_role(), '') <> 'owner'
  then
    raise exception 'Only the owner may approve a salary advance (FR-8.3).'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger advances_guard_approval
  before update on public.advances
  for each row execute function app.guard_advance_approval();
