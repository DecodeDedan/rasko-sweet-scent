-- Owner-only payroll reset. Used to remove test employees, runs and payouts
-- without clearing the rest of the business.

create or replace function app.purge_payroll_data()
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_owner() then
    raise exception 'Only the owner can purge payroll data.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.payroll_payouts;
  delete from public.payroll_items;
  delete from public.casual_work_entries;
  delete from public.advances;
  delete from public.employees;
  delete from public.payroll_runs;

  insert into public.audit_log (
    actor_id, actor_role, action, entity_table, entity_id, before, after,
    changed_fields, reason
  )
  values (
    auth.uid(), 'owner', 'payroll.purge', 'payroll', null,
    jsonb_build_object('purged', true),
    jsonb_build_object('purged', false),
    array[
      'payroll_payouts', 'payroll_items', 'casual_work_entries',
      'advances', 'employees', 'payroll_runs'
    ],
    'Owner payroll reset'
  );
end;
$$;

revoke all on function app.purge_payroll_data() from public;
grant execute on function app.purge_payroll_data() to authenticated;
