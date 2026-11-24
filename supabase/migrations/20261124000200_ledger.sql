-- ============================================================================
-- Ledger: where money is kept, and the money that moves outside sales,
-- purchases and payroll (expenses, other income, transfers between accounts).
--
-- The cash book is NOT stored. It is derived on read from:
--   payments / reversals          money in from clients
--   supplier_payments             money out to suppliers
--   payroll_items (paid)          salaries
--   casual_work_entries (paid)    casual labour
--   ledger_entries                everything else, typed in here
-- A stored running balance would be a second source of truth that drifts on
-- the next sync (same rule as invoice balances, FR-5.4, and stock, FR-6.2).
--
-- Payments recorded elsewhere carry a method, not an account. The cash book
-- places them in the default account for that method's kind and currency
-- (cash / mpesa / bank), so each kind+currency has at most one default.
-- ============================================================================

create table public.money_accounts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (length(btrim(name)) > 0),
  kind                  text not null check (kind in ('cash', 'mpesa', 'bank')),
  currency              text not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  opening_balance_cents bigint not null default 0,
  opening_date          date not null default (now() at time zone 'Africa/Nairobi')::date,
  is_default            boolean not null default false,
  details               text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

create unique index money_accounts_one_default_idx
  on public.money_accounts (kind, currency)
  where is_default and deleted_at is null;
create index money_accounts_sync_idx on public.money_accounts (updated_at, id);

create trigger money_accounts_touch_updated_at
  before insert or update on public.money_accounts
  for each row execute function app.touch_updated_at();

create table public.ledger_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  direction   text not null check (direction in ('in', 'out')),
  position    integer not null default 0,
  is_active   boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

create unique index ledger_categories_name_idx
  on public.ledger_categories (direction, lower(name))
  where deleted_at is null;
create index ledger_categories_sync_idx on public.ledger_categories (updated_at, id);

create trigger ledger_categories_touch_updated_at
  before insert or update on public.ledger_categories
  for each row execute function app.touch_updated_at();

create table public.ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  entry_date     date not null,
  direction      text not null check (direction in ('in', 'out', 'transfer')),
  account_id     uuid not null references public.money_accounts (id),
  to_account_id  uuid references public.money_accounts (id),
  category_id    uuid references public.ledger_categories (id),
  amount_cents   bigint not null check (amount_cents > 0),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  party          text,
  reference      text,
  description    text not null check (length(btrim(description)) > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint ledger_entries_shape check (
    (direction = 'transfer' and to_account_id is not null and category_id is null
       and to_account_id <> account_id)
    or
    (direction in ('in', 'out') and to_account_id is null and category_id is not null)
  )
);

create index ledger_entries_date_idx
  on public.ledger_entries (entry_date desc) where deleted_at is null;
create index ledger_entries_account_idx
  on public.ledger_entries (account_id, entry_date desc) where deleted_at is null;
create index ledger_entries_to_account_idx
  on public.ledger_entries (to_account_id) where deleted_at is null;
create index ledger_entries_category_idx
  on public.ledger_entries (category_id) where deleted_at is null;
create index ledger_entries_sync_idx on public.ledger_entries (updated_at, id);

create trigger ledger_entries_touch_updated_at
  before insert or update on public.ledger_entries
  for each row execute function app.touch_updated_at();

-- Cross-row rules a CHECK cannot see: the entry's currency is its account's,
-- a transfer never crosses currencies, and the category faces the right way.
create or replace function app.guard_ledger_entry()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_currency    text;
  v_to_currency text;
  v_direction   text;
begin
  select currency into v_currency from public.money_accounts where id = new.account_id;
  if v_currency is distinct from new.currency then
    raise exception 'The entry currency must match its account (%).', v_currency
      using errcode = 'check_violation';
  end if;

  if new.direction = 'transfer' then
    select currency into v_to_currency from public.money_accounts where id = new.to_account_id;
    if v_to_currency is distinct from v_currency then
      raise exception 'A transfer must stay in one currency.'
        using errcode = 'check_violation';
    end if;
  else
    select direction into v_direction from public.ledger_categories where id = new.category_id;
    if v_direction is distinct from new.direction then
      raise exception 'Use a money-% category for this entry.', new.direction
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger ledger_entries_guard
  before insert or update on public.ledger_entries
  for each row execute function app.guard_ledger_entry();

-- An account's currency is fixed once entries name it, or the rule above
-- (entry currency = account currency) would silently stop holding.
create or replace function app.guard_money_account()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if new.currency <> old.currency and exists (
    select 1 from public.ledger_entries
    where (account_id = old.id or to_account_id = old.id) and deleted_at is null
  ) then
    raise exception 'An account''s currency cannot change once it has entries.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger money_accounts_guard
  before update on public.money_accounts
  for each row execute function app.guard_money_account();

-- created_by / updated_by come from the session, not the device
-- (migration 20261105000100).
create trigger money_accounts_stamp_actor
  before insert or update on public.money_accounts
  for each row execute function app.stamp_actor();
create trigger ledger_categories_stamp_actor
  before insert or update on public.ledger_categories
  for each row execute function app.stamp_actor();
create trigger ledger_entries_stamp_actor
  before insert or update on public.ledger_entries
  for each row execute function app.stamp_actor();

-- ------------------------------------------------------------------- RLS
-- Finance roles see the ledger. Anyone who sees it may record an entry;
-- owner and accountant correct any entry. Accounts are the owner's.

alter table public.money_accounts enable row level security;
alter table public.money_accounts force row level security;
alter table public.ledger_categories enable row level security;
alter table public.ledger_categories force row level security;
alter table public.ledger_entries enable row level security;
alter table public.ledger_entries force row level security;

create policy money_accounts_select on public.money_accounts
  for select to authenticated using (app.can_see_finance());
create policy money_accounts_write on public.money_accounts
  for all to authenticated using (app.is_owner()) with check (app.is_owner());

create policy ledger_categories_select on public.ledger_categories
  for select to authenticated using (app.can_see_finance());
create policy ledger_categories_write on public.ledger_categories
  for all to authenticated
  using (app.current_user_role() in ('owner', 'accountant'))
  with check (app.current_user_role() in ('owner', 'accountant'));

create policy ledger_entries_select on public.ledger_entries
  for select to authenticated using (app.can_see_finance());
create policy ledger_entries_insert on public.ledger_entries
  for insert to authenticated with check (app.can_see_finance());
-- A manager may update only the rows they created. That is what lets the
-- sync engine retry an insert whose response was lost: the retried upsert
-- takes the ON CONFLICT DO UPDATE path, which needs an UPDATE policy.
create policy ledger_entries_update on public.ledger_entries
  for update to authenticated
  using (app.current_user_role() in ('owner', 'accountant')
         or (app.current_user_role() = 'manager' and created_by = (select auth.uid())))
  with check (app.current_user_role() in ('owner', 'accountant')
         or (app.current_user_role() = 'manager' and created_by = (select auth.uid())));

grant select, insert, update on public.money_accounts, public.ledger_categories,
  public.ledger_entries to authenticated;

-- ----------------------------------------------------------------- audit

create trigger ledger_entries_audit_record
  after insert on public.ledger_entries
  for each row execute function app.write_audit('ledger.record');

create trigger ledger_entries_audit_edit
  after update on public.ledger_entries
  for each row
  when (old.deleted_at is null and new.deleted_at is null and (
    old.amount_cents is distinct from new.amount_cents
    or old.account_id is distinct from new.account_id
    or old.to_account_id is distinct from new.to_account_id
    or old.direction is distinct from new.direction
    or old.entry_date is distinct from new.entry_date))
  execute function app.write_audit('ledger.edit');

create trigger ledger_entries_audit_delete
  after update on public.ledger_entries
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function app.write_audit('ledger.delete');

create trigger money_accounts_audit_opening
  after update on public.money_accounts
  for each row
  when (old.opening_balance_cents is distinct from new.opening_balance_cents
     or old.opening_date is distinct from new.opening_date)
  execute function app.write_audit('money_account.opening_balance');

-- ------------------------------------------------------------ reference
-- One default account per kind so recorded payments have a home from day
-- one. Names, opening balances and further accounts are set in the app.

insert into public.money_accounts (name, kind, currency, is_default) values
  ('Cash on hand', 'cash', 'KES', true),
  ('M-Pesa', 'mpesa', 'KES', true),
  ('Bank', 'bank', 'KES', true);

insert into public.ledger_categories (name, direction, position) values
  ('Farm inputs: fertiliser and chemicals', 'out', 10),
  ('Seedlings and planting material', 'out', 20),
  ('Packaging and sleeves', 'out', 30),
  ('Transport and fuel', 'out', 40),
  ('Pack house and cold room', 'out', 50),
  ('Electricity and water', 'out', 60),
  ('Rent and land lease', 'out', 70),
  ('Repairs and maintenance', 'out', 80),
  ('Statutory remittances (PAYE, NSSF, SHIF, Housing Levy)', 'out', 90),
  ('Taxes and licences', 'out', 100),
  ('Bank and M-Pesa charges', 'out', 110),
  ('Professional fees', 'out', 120),
  ('Airtime and internet', 'out', 130),
  ('Office and sundries', 'out', 140),
  ('Loan repayment', 'out', 150),
  ('Owner drawings', 'out', 160),
  ('Other expenses', 'out', 990),
  ('Owner capital', 'in', 10),
  ('Loan received', 'in', 20),
  ('Grants and support', 'in', 30),
  ('Sale of assets', 'in', 40),
  ('Other income', 'in', 990);
