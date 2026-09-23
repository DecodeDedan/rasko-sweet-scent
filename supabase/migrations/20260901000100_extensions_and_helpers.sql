-- ============================================================================
-- 0001  Extensions, the `app` helper schema, and the trigger functions that
--       every later migration depends on.
--
-- Implements: docs/architecture.md §1 (conventions), §6.3 (updated_at is
-- server-authoritative), §8 (gap-free document numbering).
-- ============================================================================

create extension if not exists pg_trgm;

-- Internal helpers live outside `public` so they are not exposed through
-- PostgREST as callable RPC endpoints.
create schema if not exists app;

comment on schema app is
  'Internal helpers: trigger functions, role predicates, document numbering. Not a PostgREST surface.';

-- ---------------------------------------------------------------- updated_at

-- architecture.md §6.3: `updated_at` is the sync cursor column, so the server
-- owns it absolutely. A device clock that runs fast would otherwise write rows
-- that every other device's cursor has already passed, making them permanently
-- invisible. Any client-supplied value is discarded here.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.touch_updated_at() is
  'Forces updated_at to server time on insert and update. Never trust a device clock for sync ordering.';

-- --------------------------------------------------------------- append-only

-- architecture.md §5.4: payments, reversals, stock movements, supplier payments
-- and the audit log have no UPDATE or DELETE policy. This trigger closes the
-- remaining hole: `force row level security` covers the table owner, but a
-- future SECURITY DEFINER helper would not be covered by policies alone.
create or replace function app.block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    '% is append-only; % is not permitted. Correct it with a reversing entry instead.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function app.block_mutation() is
  'Raises on UPDATE or DELETE. Attached to every append-only table (architecture.md §5.4).';

-- ------------------------------------------------------- document numbering

-- architecture.md §8.3.
--
-- A Postgres SEQUENCE cannot be used for invoice numbers: sequences are
-- explicitly non-transactional, so a rolled-back insert burns its value and
-- CACHE burns more. Both produce gaps, and FR-5.1 requires gap-free.
--
-- A counter table is transactional. The INSERT ... ON CONFLICT DO UPDATE below
-- takes a row lock on the (kind, year) row, so concurrent allocations serialise
-- and each receives a distinct consecutive value; and because the allocation
-- happens inside the caller's transaction, a rollback rolls the counter back
-- with it. Throughput is one document at a time per kind per year, which is
-- irrelevant at this business's volume and worth far more than the concurrency
-- it gives up.
create table app.document_counters (
  kind       text    not null check (kind in ('invoice', 'order', 'purchase')),
  year       integer not null check (year between 2000 and 2999),
  next_value integer not null default 1 check (next_value >= 1),
  primary key (kind, year)
);

comment on table app.document_counters is
  'Transactional counters for INV-/ORD-/PUR- numbers. See architecture.md §8.3 for why this is not a SEQUENCE.';

create or replace function app.allocate_document_number(
  p_kind   text,
  p_prefix text,
  p_year   integer
)
returns text
language plpgsql
as $$
declare
  v_seq integer;
begin
  -- One statement so that the first document of a new year cannot race: two
  -- transactions both finding no row would otherwise both try to insert it.
  insert into app.document_counters (kind, year, next_value)
  values (p_kind, p_year, 2)
  on conflict (kind, year)
    do update set next_value = app.document_counters.next_value + 1
  returning next_value - 1 into v_seq;

  return format('%s-%s-%s', p_prefix, p_year, lpad(v_seq::text, 4, '0'));
end;
$$;

comment on function app.allocate_document_number(text, text, integer) is
  'Allocates the next gap-free number for a document kind and year (FR-5.1).';
