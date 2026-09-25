-- ============================================================================
-- FR-9.5: the owner's system screen shows the last successful backup.
--
-- .github/workflows/backup.yml inserts one row after a dump has been checked
-- and uploaded to R2, over the same connection it dumped with (the postgres
-- role, which bypasses RLS). Nothing else writes here: no role the app holds
-- has insert, update or delete. The row syncs down to owners' devices like
-- audit_log, so the date is readable offline.
-- ============================================================================

create table public.backup_runs (
  id          uuid        primary key default gen_random_uuid(),
  -- Server clock, and the pull cursor (append-only, like audit_log).
  created_at  timestamptz not null default now(),
  file_name   text        not null check (file_name ~ '^rasko-[0-9]{4}-[0-9]{2}-[0-9]{2}\.dump$'),
  size_bytes  bigint      not null check (size_bytes > 0)
);

comment on table public.backup_runs is
  'One row per verified nightly backup in R2 (backup.yml). Append-only; written only by the backup job.';

create index backup_runs_sync_idx on public.backup_runs (created_at, id);

alter table public.backup_runs enable row level security;
alter table public.backup_runs force row level security;

create policy backup_runs_select_owner on public.backup_runs
  for select to authenticated
  using (app.current_user_role() = 'owner');

revoke all on public.backup_runs from anon, authenticated;
grant select on public.backup_runs to authenticated;
