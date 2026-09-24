-- ============================================================================
-- Which database a device's local copy belongs to.
--
-- A device keeps a full SQLite mirror (PRD §6). If the database underneath it
-- is replaced (a `supabase db reset`, or the app pointed from the local stack
-- at the hosted project), the device would go on showing rows the server no
-- longer has and try to push them into a database that never had them. That
-- happened: a device reset to an empty server kept showing seven demo clients.
--
-- Each database gets a random id when this migration runs. A reset reruns it
-- and gets a new one; the hosted project has its own. The sync engine compares
-- the id it last synced with against this one before every cycle and starts
-- its copy over when they differ (apps/app/src/data/sync/engine.ts).
-- ============================================================================

create table app.server_instance (
  singleton  boolean primary key default true check (singleton),
  id         uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
insert into app.server_instance default values;
revoke all on app.server_instance from public;

create or replace function public.server_instance_id()
returns uuid
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select id from app.server_instance
$$;

comment on function public.server_instance_id() is
  'Identity of this database, so a device can tell that its local copy belongs to a different one. See migration 20260926000300.';

revoke all on function public.server_instance_id() from public, anon;
grant execute on function public.server_instance_id() to authenticated;
