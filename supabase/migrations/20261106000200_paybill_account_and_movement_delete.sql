-- Apply changes that were added after the initial super-admin tools migration
-- had already been deployed.

alter table public.company_settings
  add column if not exists mpesa_paybill_account text;

create or replace function public.delete_stock_movement(movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Only a super admin can delete stock movements.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.stock_movements
  where id = movement_id;
end;
$$;

revoke all on function public.delete_stock_movement(uuid) from public;
grant execute on function public.delete_stock_movement(uuid) to authenticated;

notify pgrst, 'reload schema';
