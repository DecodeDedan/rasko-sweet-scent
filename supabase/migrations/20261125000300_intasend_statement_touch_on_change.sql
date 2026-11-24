-- ============================================================================
-- intasend-sync upserts IntaSend's whole statement every 15 minutes. The touch
-- trigger stamped every row on every run, so every device re-pulled the whole
-- statement four times an hour. A row is now stamped only when IntaSend's
-- answer actually changed it (a status moving from PENDING to AVAILABLE).
-- ============================================================================

drop trigger if exists intasend_wallet_transactions_touch_updated_at
  on public.intasend_wallet_transactions;

create trigger intasend_wallet_transactions_touch_on_insert
  before insert on public.intasend_wallet_transactions
  for each row execute function app.touch_updated_at();

create trigger intasend_wallet_transactions_touch_on_change
  before update on public.intasend_wallet_transactions
  for each row
  when (old.* is distinct from new.*)
  execute function app.touch_updated_at();
