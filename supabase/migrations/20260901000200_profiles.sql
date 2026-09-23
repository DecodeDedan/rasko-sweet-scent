-- ============================================================================
-- 0002  profiles, and the role predicates every RLS policy depends on.
--
-- Implements: architecture.md §2.1, §5.2. PRD FR-1.3, FR-1.4, T4.
-- ============================================================================

create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete restrict,
  full_name             text        not null check (length(btrim(full_name)) > 0),
  email                 text        not null,
  phone                 text        check (phone ~ '^\+254[17][0-9]{8}$'),
  role                  text        not null check (role in ('owner', 'manager', 'accountant', 'sales')),
  is_active             boolean     not null default true,
  must_change_password  boolean     not null default true,
  deactivated_at        timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,

  -- A deactivated profile must record when, so the audit trail can explain a
  -- device that stopped syncing.
  constraint profiles_deactivated_consistent
    check ((is_active and deactivated_at is null) or (not is_active and deactivated_at is not null))
);

-- Self-referencing FKs are added after the table exists.
alter table public.profiles
  add constraint profiles_created_by_fkey foreign key (created_by) references public.profiles (id),
  add constraint profiles_updated_by_fkey foreign key (updated_by) references public.profiles (id);

comment on table public.profiles is
  'Staff accounts. Supabase Auth owns credentials; this table owns role and active status. Users are deactivated, never deleted, so history keeps resolving (FR-1.4).';
comment on column public.profiles.is_active is
  'Tested by every RLS policy. Setting this false revokes server access on the offending device''s next sync even though its cached JWT still parses (T4).';

create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_sync_idx on public.profiles (updated_at, id);
create index profiles_role_idx on public.profiles (role) where is_active;

create trigger profiles_touch_updated_at
  before insert or update on public.profiles
  for each row execute function app.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- --------------------------------------------------------- role predicates

-- architecture.md §5.2.
--
-- SECURITY DEFINER breaks the infinite recursion that would otherwise occur:
-- a policy on `profiles` cannot itself read `profiles` through RLS.
--
-- `set search_path` is mandatory, not stylistic. Without it a SECURITY DEFINER
-- function is a privilege-escalation vector: a caller could create a `profiles`
-- table in a schema earlier on their own search_path and have this function
-- read it instead.
--
-- Returns NULL for a deactivated or unknown user. Every policy compares against
-- the result, and NULL comparisons are never true, so NULL denies everything.
create or replace function app.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
$$;

comment on function app.current_user_role() is
  'The caller''s role, or NULL if unknown or deactivated. SECURITY DEFINER to avoid RLS recursion on profiles.';

create or replace function app.is_owner()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.current_user_role() = 'owner'
$$;

-- Owner + manager: the two roles the PRD §3.1 matrix gives "All"/"Full" to for
-- operational modules.
create or replace function app.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.current_user_role() in ('owner', 'manager')
$$;

-- Everyone allowed to see money: owner, manager, accountant. Excludes sales,
-- whose financial visibility is always scoped to their own rows.
create or replace function app.can_see_finance()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.current_user_role() in ('owner', 'manager', 'accountant')
$$;

create or replace function app.is_authenticated_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.current_user_role() is not null
$$;

-- ------------------------------------------------- owner-only role changes

-- FR-1.3: only the owner may change a role. Enforced by trigger as well as by
-- policy, because a future permissive UPDATE policy would otherwise silently
-- open self-promotion.
create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only enforced when there IS an authenticated caller. With no JWT the caller
  -- is postgres or service_role — a migration, the SQL editor, or a backend job —
  -- and those are trusted. Without this escape hatch no admin could ever
  -- deactivate a user or repair data outside the app.
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and coalesce(app.current_user_role(), '') <> 'owner'
  then
    raise exception 'Only the owner may change a role or activation status (FR-1.3, FR-1.4).'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function app.guard_profile_privileges();
