-- ============================================================================
-- Super admin: a protected owner.
--
-- The system's administrator holds the ordinary owner role, so every existing
-- permission rule applies unchanged. The flag adds protection, not reach:
--
--   * nobody else can deactivate the super admin or change their role;
--   * only a super admin can make someone an owner or stop them being one;
--   * no signed-in caller can set or clear the flag at all. It is granted from
--     the SQL editor or the bootstrap script (scripts/create-super-admin.mjs),
--     both of which run without a user JWT.
--
-- Without this, any owner could demote or lock out the person who administers
-- the system, and the business would need database access to recover.
-- ============================================================================

alter table public.profiles
  add column is_super_admin boolean not null default false,
  add constraint profiles_super_admin_is_owner check (not is_super_admin or role = 'owner');

comment on column public.profiles.is_super_admin is
  'Protected owner. Set only without a user JWT (SQL editor, bootstrap script). See migration 20260924000100.';

create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.id = auth.uid() and p.is_active),
    false
  )
$$;

-- Replaces the 0002 guard. The first update check is unchanged; the rest are
-- new. As before, nothing is enforced for a caller with no JWT: that is postgres
-- or service_role, which is trusted, and which the edge functions use. They
-- repeat the super-admin checks themselves for that reason.
create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.is_super_admin then
      raise exception 'The super admin flag cannot be granted from the app.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.role = 'owner' and not app.is_super_admin() then
      raise exception 'Only the super admin can make someone an owner.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and coalesce(app.current_user_role(), '') <> 'owner'
  then
    raise exception 'Only the owner may change a role or activation status (FR-1.3, FR-1.4).'
      using errcode = 'insufficient_privilege';
  end if;

  if new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'The super admin flag cannot be changed from the app.'
      using errcode = 'insufficient_privilege';
  end if;

  if old.is_super_admin
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not app.is_super_admin()
  then
    raise exception 'Only the super admin can change the super admin account.'
      using errcode = 'insufficient_privilege';
  end if;

  if (new.role = 'owner') is distinct from (old.role = 'owner') and not app.is_super_admin() then
    raise exception 'Only the super admin can grant or remove the owner role.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before insert or update on public.profiles
  for each row execute function app.guard_profile_privileges();
