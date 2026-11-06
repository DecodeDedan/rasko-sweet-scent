-- Supabase rejects unqualified DELETE statements. Keep the explicit predicate
-- while retaining the SuperAdmin-only, transaction-local trigger bypass.
create or replace function public.delete_all_stock_movements()
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Only a super admin can delete all stock movements.'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.allow_stock_movement_delete', 'on', true);
  delete from public.stock_movements
  where id is not null;
end;
$$;

revoke all on function public.delete_all_stock_movements() from public;
grant execute on function public.delete_all_stock_movements() to authenticated;

notify pgrst, 'reload schema';
