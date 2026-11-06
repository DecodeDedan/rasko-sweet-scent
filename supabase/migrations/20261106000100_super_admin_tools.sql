-- Super-admin-only destructive maintenance. The edge function authenticates
-- the caller; this function supplies the transaction and database boundary.
create or replace function app.purge_business_data()
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Only a super admin can purge business data.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.payroll_payouts;
  delete from public.supplier_payments;
  delete from public.reversals;
  delete from public.payments;
  delete from public.payroll_items;
  delete from public.advances;
  delete from public.purchase_items;
  delete from public.purchases;
  delete from public.order_items;
  delete from public.invoices;
  delete from public.stock_movements;
  delete from public.product_prices;
  delete from public.products;
  delete from public.orders;
  delete from public.suppliers;
  delete from public.employees;
  delete from public.payroll_runs;
  delete from public.clients;
  delete from public.categories;
  delete from public.outbound_emails;
  delete from public.email_templates;

  insert into public.audit_log (
    actor_id, actor_role, action, entity_table, entity_id, before, after,
    changed_fields, reason
  )
  values (
    auth.uid(), 'owner', 'business_data.purge', 'business_data', null,
    jsonb_build_object('purged', true),
    jsonb_build_object('purged', true),
    array[
      'payroll_payouts', 'supplier_payments', 'reversals', 'payments',
      'payroll_items', 'advances', 'purchase_items', 'purchases',
      'order_items', 'invoices', 'stock_movements', 'product_prices',
      'products', 'orders', 'suppliers', 'employees', 'payroll_runs',
      'clients', 'categories', 'outbound_emails', 'email_templates'
    ],
    'Super admin purge of business/test data'
  );
end;
$$;

revoke all on function app.purge_business_data() from public;
grant execute on function app.purge_business_data() to authenticated;

create or replace function public.grant_super_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Only a super admin can grant super-admin access.'
      using errcode = 'insufficient_privilege';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Choose another user.'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = target_user_id and is_active and not is_super_admin
  ) then
    raise exception 'That account must be active and not already a super admin.'
      using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('app.allow_super_admin_grant', 'on', true);
  update public.profiles
  set role = 'owner', is_super_admin = true, updated_at = now()
  where id = target_user_id;
end;
$$;

revoke all on function public.grant_super_admin(uuid) from public;
grant execute on function public.grant_super_admin(uuid) to authenticated;

-- The RPC is still checked above using the caller's JWT. This narrow trigger
-- escape is only enabled for the duration of that validated function call.
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

  if current_setting('app.allow_super_admin_grant', true) = 'on' then
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
