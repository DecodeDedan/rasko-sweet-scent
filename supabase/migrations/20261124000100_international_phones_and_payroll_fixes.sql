-- ============================================================================
-- International client phones, and two gaps in the casual-labour change.
--
-- 1. Clients may be buyers abroad (packhouses, importers). Their phone is any
--    E.164 number, not only a Kenyan mobile. Every other phone column keeps
--    the Kenyan rule: staff, suppliers and the company are in Kenya.
-- 2. app.purge_payroll_data lives in the `app` schema, which PostgREST does
--    not expose (config.toml: schemas = public, graphql_public), so the
--    function's `rpc('purge_payroll_data')` could never reach it. A public
--    wrapper with the same owner check is the callable surface.
-- 3. Paying casual labour moves money and was not audited (PRD §3).
-- ============================================================================

alter table public.clients drop constraint if exists clients_phone_check;
alter table public.clients
  add constraint clients_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$');

create or replace function public.purge_payroll_data()
returns void
language sql
security invoker
set search_path = public, app, pg_temp
as $$
  select app.purge_payroll_data();
$$;

revoke all on function public.purge_payroll_data() from public, anon;
grant execute on function public.purge_payroll_data() to authenticated;

create trigger casual_work_entries_audit_pay
  after update on public.casual_work_entries
  for each row
  when (old.paid_at is null and new.paid_at is not null)
  execute function app.write_audit('casual_labour.pay');

create trigger casual_work_entries_audit_delete
  after update on public.casual_work_entries
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function app.write_audit('casual_labour.delete');
