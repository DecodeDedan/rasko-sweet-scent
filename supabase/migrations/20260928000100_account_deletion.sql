-- ============================================================================
-- Deleting a user account (owner request, 2026-09-25; docs/PROGRESS.md 15).
--
-- A person who has worked here is named on invoices, payments, stock
-- movements, payroll and the audit log: some 57 foreign keys point at
-- public.profiles. Erasing the row would either fail on every one of them or
-- destroy the business's own records, and Kenyan tax law requires those kept.
-- So deletion removes the ACCOUNT and keeps the NAME:
--
--   * the auth user is deleted: the sign-in, every session, the email;
--   * the profile keeps id and full_name so history still says who did what,
--     loses email and phone, and gains deleted_at, which syncs to every
--     device like any other change;
--   * the company address stops forwarding (the delete-user function).
--
-- profiles.id stops referencing auth.users for exactly this reason: the
-- account can go while the name stays. The id is still the auth user's id for
-- every live account; only delete-user ever leaves one without its user.
-- ============================================================================

alter table public.profiles drop constraint profiles_id_fkey;

alter table public.profiles add column deleted_at timestamptz;

alter table public.profiles alter column email drop not null;

alter table public.profiles
  add constraint profiles_deleted_consistent
    check (
      (deleted_at is null and email is not null)
      or (deleted_at is not null and email is null and phone is null and not is_active)
    ),
  -- The super admin is the business's way back in; it cannot be deleted.
  add constraint profiles_super_admin_not_deleted
    check (not (is_super_admin and deleted_at is not null));

comment on column public.profiles.deleted_at is
  'Set only by the delete-user function: the account is gone, the name stays on the records it made. Never cleared.';

-- ----------------------------------------------------------------------------
-- Guard: the app can never delete or restore an account itself. Same function
-- as migration 20260924000100 with the deleted_at rules added; a trusted
-- caller (auth.uid() is null: the service role, a migration) is unaffected.
-- ----------------------------------------------------------------------------
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
    if new.deleted_at is not null then
      raise exception 'An account cannot be created deleted.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'Only the delete-user function can delete an account.'
      using errcode = 'insufficient_privilege';
  end if;

  if old.deleted_at is not null then
    raise exception 'A deleted account cannot be changed.'
      using errcode = 'insufficient_privilege';
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

-- ----------------------------------------------------------------------------
-- A sign-in deleted anywhere else (the Supabase dashboard, a script) marks its
-- profile deleted too, instead of leaving a row that still reads "active" and
-- still holds the email. delete-user has usually done this already, so the
-- update then matches nothing. The company address rule is not reachable from
-- here; docs/company-email.md says to delete through the app for that reason.
-- ----------------------------------------------------------------------------
create or replace function app.retire_profile_of_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
     set email          = null,
         phone          = null,
         is_active      = false,
         deactivated_at = coalesce(deactivated_at, now()),
         deleted_at     = now()
   where id = old.id
     and deleted_at is null
     and not is_super_admin;
  return old;
end;
$$;

revoke all on function app.retire_profile_of_deleted_user() from public;

create trigger retire_profile_on_auth_delete
  after delete on auth.users
  for each row execute function app.retire_profile_of_deleted_user();
