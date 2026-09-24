-- ============================================================================
-- Branded email to clients: templates, an outbound queue, and dispatch.
--
-- Email follows the same rule as every other write (PRD §6): the device never
-- touches the network for it. Composing an email inserts a queued row into the
-- local mirror; sync carries it up; the insert trigger below asks the send-email
-- edge function to deliver it; the function records the outcome on the row, and
-- sync carries the status back down. An email written offline on a farm with no
-- signal goes out the moment the device reconnects, exactly once.
--
-- Exactly once rests on three things:
--   * the device pushes this table insert-only (ignoreDuplicates), so a retried
--     push can never reset a sent row to queued (tables.ts pushInsertOnly);
--   * the function claims a row with one conditional UPDATE, so two dispatches
--     of the same id cannot both send it;
--   * a signed-in caller cannot update or delete a row at all.
--
-- Wording lives in email_templates, editable by the owner or a manager in
-- Settings. The brand frame (logo header, footer, sign-off) lives in code
-- (supabase/functions/_shared/email/layout.js) so no edit can break it.
-- ============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ----------------------------------------------------------- email_templates

create table public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique
              check (key in ('invoice', 'receipt', 'order_confirmation', 'payment_reminder', 'message')),
  label       text not null,
  subject     text not null check (length(btrim(subject)) > 0),
  heading     text not null check (length(btrim(heading)) > 0),
  -- Plain text. A blank line starts a paragraph; {{placeholders}} are filled
  -- from the related record at send time and HTML-escaped.
  body        text not null check (length(btrim(body)) > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

comment on table public.email_templates is
  'Client email wording, one row per kind. The brand frame is fixed in code; see migration 20260925000100.';

create index email_templates_sync_idx on public.email_templates (updated_at, id);
create trigger email_templates_touch_updated_at
  before insert or update on public.email_templates
  for each row execute function app.touch_updated_at();

insert into public.email_templates (key, label, subject, heading, body) values
  ('invoice', 'Invoice', 'Invoice {{invoice_number}} from {{company_name}}',
   'Invoice {{invoice_number}}',
   'Dear {{client_name}},

Please find your invoice below. The amount due is {{balance}}, payable by {{due_date}}.

Payment details are at the foot of this email. Quote the invoice number as your reference so we can match your payment.'),
  ('receipt', 'Payment receipt', 'Receipt for your payment of {{amount}}',
   'Payment received',
   'Dear {{client_name}},

Thank you. We have received {{amount}} by {{method}} on {{paid_date}} against invoice {{invoice_number}}.

The balance remaining on that invoice is {{balance}}.'),
  ('order_confirmation', 'Order confirmation', 'Your order {{order_number}} is confirmed',
   'Order {{order_number}} confirmed',
   'Dear {{client_name}},

Thank you for your order. The details are below, with delivery planned for {{delivery_date}}.

If anything needs to change, reply to this email or call us and we will update the order.'),
  ('payment_reminder', 'Payment reminder', 'Reminder: invoice {{invoice_number}} is overdue',
   'A reminder about invoice {{invoice_number}}',
   'Dear {{client_name}},

Our records show {{balance}} outstanding on invoice {{invoice_number}}, which fell due on {{due_date}}, {{days_overdue}} days ago.

If you have already paid, please send us the payment reference and we will update our records. Otherwise, the payment details are below.'),
  ('message', 'General message', 'A message from {{company_name}}',
   'A message from {{company_name}}',
   'Dear {{client_name}},');

-- ----------------------------------------------------------- outbound_emails

create table public.outbound_emails (
  id            uuid primary key default gen_random_uuid(),
  template_key  text not null references public.email_templates (key),
  to_email      text not null check (to_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  to_name       text,
  client_id     uuid references public.clients (id),
  related_table text check (related_table in ('invoices', 'payments', 'orders')),
  related_id    uuid,
  -- The sender's own words, added under the template's body. Bounded so a
  -- queued row cannot carry an unbounded payload.
  personal_note text check (personal_note is null or length(personal_note) <= 4000),

  status        text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts      integer not null default 0 check (attempts >= 0),
  last_error    text,
  sent_at       timestamptz,
  provider_id   text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),

  constraint outbound_emails_related_pair check ((related_table is null) = (related_id is null)),
  constraint outbound_emails_kind_needs_record check (
    template_key = 'message' or related_table is not null
  )
);

comment on table public.outbound_emails is
  'Queued and sent client email. Inserted by devices through sync; delivered by the send-email function. See migration 20260925000100.';

create index outbound_emails_sync_idx on public.outbound_emails (updated_at, id);
create index outbound_emails_related_idx on public.outbound_emails (related_table, related_id);
create index outbound_emails_queued_idx on public.outbound_emails (created_at) where status = 'queued';
create trigger outbound_emails_touch_updated_at
  before insert or update on public.outbound_emails
  for each row execute function app.touch_updated_at();

-- A device decides who is emailed about what. It never decides the delivery
-- state, the attempt count or the server clock.
create or replace function app.force_outbound_email_defaults()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.status      := 'queued';
    new.attempts    := 0;
    new.last_error  := null;
    new.sent_at     := null;
    new.provider_id := null;
    new.created_at  := now();
    new.created_by  := auth.uid();
  end if;
  return new;
end;
$$;

create trigger outbound_emails_force_defaults
  before insert on public.outbound_emails
  for each row execute function app.force_outbound_email_defaults();

-- ------------------------------------------------------------------- RLS

alter table public.email_templates enable row level security;
alter table public.email_templates force row level security;
alter table public.outbound_emails enable row level security;
alter table public.outbound_emails force row level security;

create policy email_templates_select on public.email_templates
  for select to authenticated using (app.is_authenticated_staff());
create policy email_templates_update on public.email_templates
  for update to authenticated using (app.is_staff()) with check (app.is_staff());

-- The related record must be one the sender can already see. The subqueries
-- run under the sender's own RLS, so sales can email about their own clients'
-- invoices and nothing else (FR-3.4), and the function, which reads with the
-- service key, only ever renders a record the sender was entitled to.
create policy outbound_emails_insert on public.outbound_emails
  for insert to authenticated
  with check (
    app.is_authenticated_staff()
    and (client_id is null or exists (select 1 from public.clients c where c.id = client_id))
    and (
      related_table is null
      or (related_table = 'invoices' and exists (select 1 from public.invoices i where i.id = related_id))
      or (related_table = 'payments' and exists (select 1 from public.payments p where p.id = related_id))
      or (related_table = 'orders'   and exists (select 1 from public.orders o   where o.id = related_id))
    )
  );

create policy outbound_emails_select on public.outbound_emails
  for select to authenticated
  using (app.is_authenticated_staff() and (created_by = auth.uid() or app.can_see_finance()));

grant select, update on public.email_templates to authenticated;
grant select, insert on public.outbound_emails to authenticated;

-- -------------------------------------------------------------- dispatch

-- Where the send-email function lives. Different per environment, so it is a
-- row, not a constant: supabase/seeds/local.sql sets it for the local stack and
-- docs/email-setup.md gives the one statement for a hosted project. While it is
-- null, email queues and nothing is lost; the sweep below sends the backlog as
-- soon as it is set.
create table app.email_dispatch (
  id           boolean primary key default true check (id),
  function_url text
);
insert into app.email_dispatch (id, function_url) values (true, null);
revoke all on app.email_dispatch from public;

create or replace function app.dispatch_email(email_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  target text;
begin
  select function_url into target from app.email_dispatch;
  if target is null then
    return;
  end if;
  -- The body carries only the id. The function re-reads the row with the
  -- service key and sends it only if it is still queued, so a forged call can
  -- at most deliver an email someone was already entitled to queue.
  perform net.http_post(
    url     := target,
    body    := jsonb_build_object('id', email_id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
end;
$$;

create or replace function app.dispatch_new_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.dispatch_email(new.id);
  return new;
end;
$$;

create trigger outbound_emails_dispatch
  after insert on public.outbound_emails
  for each row execute function app.dispatch_new_email();

-- The sweep: anything still queued a minute after it arrived is dispatched
-- again. Covers a function that was down, a dispatch URL set after the fact,
-- and the retry the function schedules after a transient SMTP failure. Rows
-- stuck in 'sending' for ten minutes (a function that died mid-send) go back
-- to the queue; the attempt cap stops a permanently bad row looping.
create or replace function app.sweep_outbound_emails()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pending uuid;
begin
  update public.outbound_emails
     set status = 'queued'
   where status = 'sending' and updated_at < now() - interval '10 minutes' and attempts < 5;

  update public.outbound_emails
     set status = 'failed', last_error = coalesce(last_error, 'Gave up after 5 attempts.')
   where status = 'queued' and attempts >= 5;

  for pending in
    select id from public.outbound_emails
     where status = 'queued' and updated_at < now() - interval '1 minute'
     order by created_at
     limit 50
  loop
    perform app.dispatch_email(pending);
  end loop;
end;
$$;

select cron.schedule('sweep-outbound-emails', '* * * * *', 'select app.sweep_outbound_emails()');
