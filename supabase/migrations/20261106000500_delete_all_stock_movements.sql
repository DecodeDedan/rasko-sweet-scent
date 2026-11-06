-- Explicit SuperAdmin demo cleanup. Unlike normal corrections, this removes
-- the entire append-only ledger by a deliberate, audited maintenance action.
create or replace function app.block_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.allow_stock_movement_delete', true) = 'on' then
    return old;
  end if;
  raise exception
    '% is append-only; % is not permitted. Correct it with a reversing entry instead.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

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
  delete from public.stock_movements;
end;
$$;

revoke all on function public.delete_all_stock_movements() from public;
grant execute on function public.delete_all_stock_movements() to authenticated;

notify pgrst, 'reload schema';
