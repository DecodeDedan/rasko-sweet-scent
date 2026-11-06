-- Apply changes that were added after the initial super-admin tools migration
-- had already been deployed.

alter table public.company_settings
  add column if not exists mpesa_paybill_account text;

create or replace function public.delete_stock_movement(movement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  reversal_id uuid;
begin
  if not app.is_super_admin() then
    raise exception 'Only a super admin can delete stock movements.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.stock_movements where id = movement_id) then
    raise exception 'Stock movement not found.';
  end if;

  select id into reversal_id
  from public.stock_movements
  where reason = 'Reversal of movement ' || movement_id
  limit 1;
  if reversal_id is not null then
    return jsonb_build_object('reversal_id', reversal_id);
  end if;

  reversal_id := gen_random_uuid();
  insert into public.stock_movements (
    id, product_id, movement_type, quantity, unit_cost_cents,
    source_table, source_id, occurred_at, reason, created_by
  )
  select reversal_id, product_id, 'adjustment', -quantity, unit_cost_cents,
         'manual', null, now(), 'Reversal of movement ' || movement_id, auth.uid()
  from public.stock_movements
  where id = movement_id;
  return jsonb_build_object('reversal_id', reversal_id);
end;
$$;

revoke all on function public.delete_stock_movement(uuid) from public;
grant execute on function public.delete_stock_movement(uuid) to authenticated;

notify pgrst, 'reload schema';
