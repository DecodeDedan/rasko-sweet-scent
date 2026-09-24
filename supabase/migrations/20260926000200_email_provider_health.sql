-- ============================================================================
-- Email provider health, shared by every function instance.
--
-- Email fails over Brevo -> Resend -> Gmail (supabase/functions/_shared/email/
-- transport.js). The failover is only fast if a provider already known to be
-- down or over its daily quota is skipped without first waiting on it again.
-- Edge function instances are short-lived and many, so that memory lives
-- here: one row per provider that has failed, with when to try it again.
--
-- Written and read only by the functions' service key. RLS is on with no
-- policy and the table is ungranted, so no signed-in user or anon caller can
-- read it or mark a provider down.
-- ============================================================================

create table public.email_provider_health (
  provider        text primary key check (provider in ('brevo', 'resend', 'gmail', 'mailpit')),
  unhealthy_until timestamptz,
  last_error      text check (last_error is null or length(last_error) <= 500),
  updated_at      timestamptz not null default now()
);

comment on table public.email_provider_health is
  'When each email provider may be tried again after a failure. Service role only. See migration 20260926000200.';

alter table public.email_provider_health enable row level security;
alter table public.email_provider_health force row level security;
revoke all on public.email_provider_health from anon, authenticated;
