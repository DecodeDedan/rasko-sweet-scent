-- ============================================================================
-- 0007  invoices, payments, reversals, and gap-free invoice numbering.
--
-- Implements: architecture.md §2.5 – §2.7, §8. PRD FR-5.1 – FR-5.8, T3.
-- ============================================================================

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),

  -- NULL until the row reaches the server. FR-5.1 requires gap-free numbering,
  -- which cannot be allocated on an offline device — see architecture.md §8.2.
  invoice_number text,

  order_id  uuid references public.orders (id),
  client_id uuid references public.clients (id),

  -- Snapshots, not lookups. The invoice PDF must not change when the client
  -- record or the company profile is later edited (FR-5.2).
  client_snapshot  jsonb not null default '{}'::jsonb,
  company_snapshot jsonb not null default '{}'::jsonb,

  -- Only what a human actually sets. FR-5.6's unpaid / partially paid / paid /
  -- overdue are functions of payments and today's date, so they are computed in
  -- the invoice_status view, never stored (architecture.md §2.5).
  status text not null default 'draft' check (status in ('draft', 'issued', 'voided')),

  issue_date date not null default current_date,
  due_date   date not null default current_date,

  subtotal_cents bigint  not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint  not null default 0 check (discount_cents >= 0),
  vat_rate_bp    integer not null default 0 check (vat_rate_bp between 0 and 10000),
  vat_cents      bigint  not null default 0 check (vat_cents >= 0),
  total_cents    bigint  not null default 0 check (total_cents >= 0),

  voided_at   timestamptz,
  voided_by   uuid references public.profiles (id),
  void_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint invoices_due_after_issue check (due_date >= issue_date),

  constraint invoices_void_consistent check (
    (status <> 'voided' and voided_at is null)
    or (status = 'voided' and voided_at is not null
        and void_reason is not null and length(btrim(void_reason)) > 0)
  ),

  -- An issued invoice must carry a number; a draft need not.
  constraint invoices_issued_is_numbered check (status = 'draft' or invoice_number is not null)
);

comment on column public.invoices.invoice_number is
  'INV-YYYY-NNNN. Server-assigned on first arrival, gap-free, never reused. NULL means created offline and not yet synced (architecture.md §8).';
comment on column public.invoices.status is
  'Only draft / issued / voided are stored. The other FR-5.6 statuses are derived — see the invoice_status view.';

-- A voided invoice keeps its number: that is how "gap-free" and "never reused"
-- coexist. Nothing is deleted from the sequence and nothing is recycled.
create unique index invoices_number_key on public.invoices (invoice_number) where invoice_number is not null;
create index invoices_sync_idx     on public.invoices (updated_at, id);
create index invoices_client_idx   on public.invoices (client_id) where deleted_at is null;
create index invoices_order_idx    on public.invoices (order_id) where deleted_at is null;
create index invoices_created_by_idx on public.invoices (created_by);
create index invoices_due_date_idx on public.invoices (due_date) where status = 'issued';

create trigger invoices_touch_updated_at
  before insert or update on public.invoices
  for each row execute function app.touch_updated_at();

alter table public.invoices enable row level security;
alter table public.invoices force row level security;

-- ------------------------------------------------------- invoice numbering

-- architecture.md §8.4. Fires ONLY on INSERT and ONLY when the number is null:
--
--   * A re-pushed invoice hits `on conflict (id) do update`, which is an UPDATE,
--     so this trigger does not fire and no number is burned or reallocated.
--     That is what makes a retried sync safe (T6).
--   * The year comes from issue_date, not now(), so an invoice issued offline on
--     31 December and synced on 2 January belongs to the earlier year's
--     sequence — what the client's accountant will expect (§8.5).
-- SECURITY DEFINER is required, not decorative: app.document_counters is
-- deliberately ungranted to `authenticated` so no client can read or burn
-- numbers directly. Without this the trigger would run as the caller and every
-- order insert would fail with "permission denied for table document_counters".
create or replace function app.assign_invoice_number()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
begin
  if new.invoice_number is null and new.status <> 'draft' then
    new.invoice_number := app.allocate_document_number(
      'invoice', 'INV', extract(year from new.issue_date)::integer);
  end if;
  return new;
end;
$$;

create trigger invoices_assign_number
  before insert on public.invoices
  for each row execute function app.assign_invoice_number();

-- Once set, an invoice number is immutable. Also handles the draft -> issued
-- transition, where the number is allocated for the first time.
create or replace function app.freeze_invoice_number()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
begin
  if old.invoice_number is not null and new.invoice_number is distinct from old.invoice_number then
    raise exception 'Invoice number % cannot be changed or reused (FR-5.1).', old.invoice_number
      using errcode = 'restrict_violation';
  end if;

  if new.invoice_number is null and new.status <> 'draft' then
    new.invoice_number := app.allocate_document_number(
      'invoice', 'INV', extract(year from new.issue_date)::integer);
  end if;

  return new;
end;
$$;

create trigger invoices_freeze_number
  before update on public.invoices
  for each row execute function app.freeze_invoice_number();

-- ------------------------------------------------------------------ payments

-- APPEND-ONLY (architecture.md §2.6). The absent columns are the design: there
-- is no updated_at, no updated_by and no deleted_at, no UPDATE or DELETE policy
-- for any role, and a trigger that raises on both.
--
-- This is what makes T3 safe. Two devices recording payments offline against
-- the same invoice produce two independent inserts that both survive, and the
-- balance is a sum, so nothing is lost and nothing needs merging.
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id),
  amount_cents bigint not null check (amount_cents > 0),
  method       text not null check (method in ('mpesa', 'cash', 'bank_transfer', 'cheque')),
  reference    text,
  paid_at      timestamptz not null default now(),
  received_by  uuid not null references public.profiles (id),
  notes        text,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

comment on table public.payments is
  'Append-only. Always positive; a correction is a row in reversals, never a negative payment or an edit (FR-5.5).';
comment on column public.payments.paid_at is
  'When the money moved — device time, not when the row reached the server.';

-- Append-only tables have no updated_at, so the sync cursor pages on created_at.
create index payments_sync_idx     on public.payments (created_at, id);
create index payments_invoice_idx  on public.payments (invoice_id);
create index payments_paid_at_idx  on public.payments (paid_at desc);
create index payments_received_by_idx on public.payments (received_by);

create trigger payments_append_only
  before update or delete on public.payments
  for each row execute function app.block_mutation();

alter table public.payments enable row level security;
alter table public.payments force row level security;

-- ----------------------------------------------------------------- reversals

create table public.reversals (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references public.payments (id),
  amount_cents bigint not null check (amount_cents > 0),
  reason       text not null check (length(btrim(reason)) > 0),
  reversed_at  timestamptz not null default now(),

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

comment on table public.reversals is
  'Append-only corrections against a payment. Positive amounts, subtracted when computing balance. Restricted to manager and owner (FR-5.5).';

create index reversals_sync_idx    on public.reversals (created_at, id);
create index reversals_payment_idx on public.reversals (payment_id);

-- Total reversals against a payment may not exceed it. A CHECK cannot span
-- rows, so this is a trigger.
create or replace function app.guard_reversal_total()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payment bigint;
  v_reversed bigint;
begin
  select amount_cents into v_payment from public.payments where id = new.payment_id;

  select coalesce(sum(amount_cents), 0) into v_reversed
  from public.reversals where payment_id = new.payment_id;

  if v_reversed + new.amount_cents > v_payment then
    raise exception
      'Reversals against payment % would total % cents, exceeding the payment of % cents (FR-5.5).',
      new.payment_id, v_reversed + new.amount_cents, v_payment
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger reversals_guard_total
  before insert on public.reversals
  for each row execute function app.guard_reversal_total();

create trigger reversals_append_only
  before update or delete on public.reversals
  for each row execute function app.block_mutation();

alter table public.reversals enable row level security;
alter table public.reversals force row level security;

-- ------------------------------------------- FR-3.5 client delete guard

-- Now that invoices, payments and reversals exist, the balance can be computed
-- directly rather than through a view created later in the sequence.
create or replace function app.guard_client_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outstanding bigint;
begin
  if new.deleted_at is null or old.deleted_at is not null then
    return new;
  end if;

  select coalesce(sum(
           i.total_cents
           - coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = i.id), 0)
           + coalesce((select sum(r.amount_cents)
                       from public.reversals r
                       join public.payments p2 on p2.id = r.payment_id
                       where p2.invoice_id = i.id), 0)
         ), 0)
  into v_outstanding
  from public.invoices i
  where i.client_id = new.id
    and i.status = 'issued'
    and i.deleted_at is null;

  if v_outstanding > 0 then
    raise exception
      'Cannot delete client "%": % cents still outstanding on issued invoices (FR-3.5).',
      new.name, v_outstanding
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger clients_guard_soft_delete
  before update on public.clients
  for each row execute function app.guard_client_soft_delete();
