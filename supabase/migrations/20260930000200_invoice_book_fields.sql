-- ============================================================================
-- Fields the paper invoice book carries that the schema did not (FR-5.2).
--
--   company_settings.whatsapp  the second letterhead number, printed with the
--                              WhatsApp mark beside the phone.
--   orders.currency            keyed on the order: trade buyers are invoiced
--   invoices.currency          in shillings or in dollars. Amounts stay integer
--                              minor units (cents) of that currency. Existing
--                              rows are shillings, hence the default.
--   orders.delivery_number     the book's "Delivery No", keyed on the order.
--
-- Additive only; dropping the four columns reverses it.
-- ============================================================================

alter table public.company_settings
  add column whatsapp text check (whatsapp ~ '^\+254[17][0-9]{8}$');

update public.company_settings
set whatsapp = coalesce(whatsapp, '+254101339635')
where id = '00000000-0000-0000-0000-000000000001';

alter table public.orders
  add column currency text not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  add column delivery_number text check (char_length(delivery_number) <= 40);

alter table public.invoices
  add column currency text not null default 'KES' check (currency ~ '^[A-Z]{3}$');

comment on column public.invoices.currency is
  'ISO 4217 code copied from the order. Every *_cents column is in its minor unit.';
