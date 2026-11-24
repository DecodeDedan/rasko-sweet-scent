-- Piece-work/casual labour is separate from monthly payroll.

alter table public.employees
  drop constraint employees_salary_type_check;

alter table public.employees
  add constraint employees_salary_type_check
  check (salary_type in ('monthly', 'daily', 'casual'));

comment on column public.employees.basic_pay_cents is
  'Monthly salary or daily rate for permanent/daily employees. Casual employees use casual_work_entries and keep this at zero.';

create or replace function app.normalize_casual_employee()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if new.salary_type = 'casual' then
    new.basic_pay_cents := 0;
    new.allowances := '[]'::jsonb;
    new.kra_pin := null;
    new.nssf_number := null;
    new.shif_number := null;
  end if;
  return new;
end;
$$;

create trigger employees_normalize_casual
  before insert or update on public.employees
  for each row execute function app.normalize_casual_employee();

create table public.casual_work_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  work_date date not null,
  work_type text not null check (length(btrim(work_type)) > 0),
  unit text not null check (length(btrim(unit)) > 0),
  quantity numeric(12,3) not null check (quantity > 0),
  rate_cents bigint not null check (rate_cents >= 0),
  notes text,
  paid_at timestamptz,
  payment_method text check (payment_method in ('mpesa', 'bank')),
  payment_reference text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint casual_work_payment_consistent check (
    (paid_at is null and payment_method is null and payment_reference is null)
    or
    (paid_at is not null and payment_method is not null
      and length(btrim(coalesce(payment_reference, ''))) > 0)
  )
);

create index casual_work_entries_employee_date_idx
  on public.casual_work_entries (employee_id, work_date desc)
  where deleted_at is null;
create index casual_work_entries_sync_idx
  on public.casual_work_entries (updated_at, id);

create trigger casual_work_entries_touch_updated_at
  before insert or update on public.casual_work_entries
  for each row execute function app.touch_updated_at();

alter table public.casual_work_entries enable row level security;
alter table public.casual_work_entries force row level security;

create policy casual_work_entries_select on public.casual_work_entries
  for select to authenticated
  using (app.can_see_finance());

create policy casual_work_entries_write on public.casual_work_entries
  for all to authenticated
  using (app.is_owner())
  with check (app.is_owner());

grant select, insert, update on public.casual_work_entries to authenticated;
