-- ============================================================================
-- 0010  audit_log.
--
-- Implements: architecture.md §7. PRD §3 rules, FR-9.6.
--
-- Written by database triggers, never by the client. An audit trail a client
-- can choose not to write is not an audit trail.
-- ============================================================================

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles (id),

  -- Denormalised deliberately: the role AT THE TIME of the action. Reading it
  -- from profiles later would misreport history after a promotion.
  actor_role   text,

  action       text not null,
  entity_table text not null,
  entity_id    uuid not null,
  before       jsonb,
  after        jsonb,
  changed_fields text[],
  reason       text,
  device_id    uuid,

  -- Device time: when the user did it, possibly offline.
  occurred_at  timestamptz not null default now(),
  -- Server time: when it reached Postgres. The gap between the two is exactly
  -- the offline window, which is the first thing anyone investigating a
  -- discrepancy needs to know.
  recorded_at  timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only and immutable for every role including owner. Populated by triggers when a change reaches the server, so offline actions are still audited at push time (architecture.md §7.2).';

create index audit_log_entity_idx on public.audit_log (entity_table, entity_id, recorded_at desc);
create index audit_log_actor_idx  on public.audit_log (actor_id, recorded_at desc);
create index audit_log_action_idx on public.audit_log (action, recorded_at desc);
create index audit_log_sync_idx   on public.audit_log (recorded_at, id);

-- No UPDATE or DELETE policy exists for any role. This trigger additionally
-- covers the table-owner path that `force row level security` alone would not.
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function app.block_mutation();

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

-- ------------------------------------------------------- the audit writer

-- SECURITY DEFINER so it can insert into a table that has no INSERT policy for
-- anyone. That is the point: the only path into audit_log is this function.
create or replace function app.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action    text := tg_argv[0];
  v_before    jsonb;
  v_after     jsonb;
  v_entity_id uuid;
  v_changed   text[];
  v_occurred  timestamptz;
  v_reason    text := null;
begin
  if tg_op = 'DELETE' then
    v_before    := to_jsonb(old);
    v_entity_id := old.id;
  elsif tg_op = 'INSERT' then
    v_after     := to_jsonb(new);
    v_entity_id := new.id;
  else
    v_before    := to_jsonb(old);
    v_after     := to_jsonb(new);
    v_entity_id := new.id;

    select array_agg(key order by key)
    into v_changed
    from jsonb_each(v_after) e(key, value)
    where v_before -> e.key is distinct from v_after -> e.key
      -- updated_at changes on every write; recording it as a "change" would
      -- make every audit row look identical and hide the real diff.
      and e.key <> 'updated_at';

    -- Nothing of substance changed; do not write a row.
    if v_changed is null then
      return new;
    end if;
  end if;

  -- Device time, where the row carries one.
  v_occurred := coalesce(
    (v_after ->> 'paid_at')::timestamptz,
    (v_after ->> 'occurred_at')::timestamptz,
    (v_after ->> 'created_at')::timestamptz,
    (v_before ->> 'created_at')::timestamptz,
    now()
  );

  v_reason := coalesce(
    v_after ->> 'reason',
    v_after ->> 'void_reason',
    v_after ->> 'cancellation_reason'
  );

  insert into public.audit_log (
    actor_id, actor_role, action, entity_table, entity_id,
    before, after, changed_fields, reason, occurred_at, recorded_at
  ) values (
    auth.uid(), app.current_user_role(), v_action, tg_table_name, v_entity_id,
    v_before, v_after, v_changed, v_reason, v_occurred, now()
  );

  return coalesce(new, old);
end;
$$;

comment on function app.write_audit() is
  'Generic audit trigger. Pass the action name as the first trigger argument, e.g. EXECUTE FUNCTION app.write_audit(''payment.record'').';
