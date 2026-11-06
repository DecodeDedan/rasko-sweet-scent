-- The original account is the permanent recovery administrator.
create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(old.email, new.email, '')) = 'dedan.okware@raskosweetscent.com'
     and new.email is distinct from old.email
  then
    raise exception 'The primary super admin email cannot be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  if lower(coalesce(old.email, new.email, '')) = 'dedan.okware@raskosweetscent.com'
     and (
       new.is_active is distinct from true
       or new.is_super_admin is distinct from true
       or new.role is distinct from 'owner'
       or new.deleted_at is not null
     )
  then
    raise exception 'The primary super admin account cannot be offboarded or removed.'
      using errcode = 'insufficient_privilege';
  end if;

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

  if (new.role = 'owner') is distinct from (old.role = 'owner') and not app.is_super_admin() then
    raise exception 'Only the super admin can grant or remove the owner role.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before insert or update on public.profiles
  for each row execute function app.guard_profile_privileges();

notify pgrst, 'reload schema';
