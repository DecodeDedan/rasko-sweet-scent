-- ============================================================================
-- IntaSend's own wallet statement, copied for reconciliation.
--
-- The function intasend-sync fills this from IntaSend every 15 minutes and on
-- demand. Devices pull it (owner, manager, accountant) and the Ledger compares
-- it with the books: IntaSend's running balance against the IntaSend wallet
-- account, and each IntaSend line against a payout, fee or top-up transfer.
-- Server-owned: no role may write it.
-- ============================================================================

create table public.intasend_wallet_transactions (
  id                     uuid primary key default gen_random_uuid(),
  transaction_id         text not null unique,
  trans_type             text not null,
  value_cents            bigint not null,
  running_balance_cents  bigint not null,
  currency               text not null default 'KES',
  narrative              text,
  status                 text,
  occurred_at            timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index intasend_wallet_transactions_time_idx
  on public.intasend_wallet_transactions (occurred_at desc);
create index intasend_wallet_transactions_sync_idx
  on public.intasend_wallet_transactions (updated_at, id);

create trigger intasend_wallet_transactions_touch_updated_at
  before insert or update on public.intasend_wallet_transactions
  for each row execute function app.touch_updated_at();

alter table public.intasend_wallet_transactions enable row level security;
alter table public.intasend_wallet_transactions force row level security;

create policy intasend_wallet_transactions_select on public.intasend_wallet_transactions
  for select to authenticated using (app.can_see_finance());

grant select on public.intasend_wallet_transactions to authenticated;

-- Every 15 minutes, through the same function address the payout dispatch
-- already holds (docs/intasend-setup.md). Nothing is sent while it is unset.
select cron.schedule(
  'sync-intasend-wallet',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url     := replace(function_url, '/mpesa-b2c', '/intasend-sync'),
      body    := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json')
    )
    from app.payout_dispatch
    where function_url is not null
  $job$
);
