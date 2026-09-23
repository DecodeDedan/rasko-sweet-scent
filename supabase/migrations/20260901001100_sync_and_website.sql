-- ============================================================================
-- 0011  sync_devices, website_contact_messages.
--
-- Implements: architecture.md §2.24, §2.25. PRD FR-9.5, §7 (anon surface).
-- ============================================================================

-- Per-device bookkeeping. The pull CURSORS live in each device's local SQLite
-- (architecture.md §9.2) and are never synced; this table is the server-side
-- record of which devices exist and when each last reported in.
create table public.sync_devices (
  id            uuid primary key,
  profile_id    uuid not null references public.profiles (id),
  platform      text check (platform in ('windows', 'android')),
  app_version   text,
  last_seen_at  timestamptz,
  last_push_at  timestamptz,
  last_pull_at  timestamptz,
  pending_count integer not null default 0 check (pending_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sync_devices is
  'One row per installed device. Lets the owner see a device that has stopped syncing (FR-9.5). Cursors are device-local, not here.';
comment on column public.sync_devices.pending_count is
  'Last reported outbox depth — what the FR-9.4 sync indicator shows.';

create index sync_devices_profile_idx on public.sync_devices (profile_id);
create index sync_devices_seen_idx    on public.sync_devices (last_seen_at desc);

create trigger sync_devices_touch_updated_at
  before insert or update on public.sync_devices
  for each row execute function app.touch_updated_at();

alter table public.sync_devices enable row level security;
alter table public.sync_devices force row level security;

-- ------------------------------------------------- website_contact_messages

-- The ONLY table the anon role can reach, and it can only insert (PRD §7).
-- Not synced to devices: it is website data, read in an online admin surface.
create table public.website_contact_messages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 120),
  email         text not null check (length(btrim(email)) between 3 and 200),
  phone         text check (length(btrim(phone)) <= 20),
  message       text not null check (length(btrim(message)) between 1 and 4000),
  captcha_token text,
  source_page   text check (length(source_page) <= 200),
  handled_at    timestamptz,
  handled_by    uuid references public.profiles (id),

  created_at timestamptz not null default now()
);

comment on table public.website_contact_messages is
  'Insert-only for anon, captcha-protected. Length caps are deliberate: they blunt abuse of the one publicly writable table (PRD §7).';

create index website_contact_messages_created_idx on public.website_contact_messages (created_at desc);
create index website_contact_messages_unhandled_idx
  on public.website_contact_messages (created_at desc) where handled_at is null;

alter table public.website_contact_messages enable row level security;
alter table public.website_contact_messages force row level security;
