-- ============================================================================
-- Demo seed data — Rasko Sweet Scent
--
-- FOR LOCAL AND STAGING ONLY. Never run against production.
--
-- Every person, business, phone number, national ID, KRA PIN and figure below
-- is INVENTED. No real personal data appears here, and the business names are
-- fictional so the data cannot be mistaken for a real customer list.
--
-- Money is integer cents (PRD §7): 6000 = KES 60.00.
-- Phone numbers satisfy the +254 CHECK constraint on every table.
--
-- NOT loaded automatically: `supabase db reset` gives an empty, real database
-- (config.toml [db.seed] is off). Load it by hand for docs/policy-tests.md:
--     docker exec -i supabase_db_rasko-sweetscent psql -U postgres < supabase/demo/demo-data.sql
-- Statutory rates, tax config and the settings row come from migrations.
-- Idempotent: re-running does nothing.
--
-- Fixed UUIDs are deliberate — docs/policy-tests.md refers to these exact ids.
-- ============================================================================

-- ---------------------------------------------------------------- auth users

-- Complete, signable-in accounts for local and staging demos.
--
-- All four share the password below. That is safe only because this file is for
-- local and staging, never production (see the header). Production accounts are
-- created by invitation and the user sets their own password on first sign-in
-- (FR-1.6).
--
--     Password for every seeded account:  rasko-demo-2026
--
-- GoTrue needs more than a row in auth.users to authenticate someone: `aud` and
-- `role` must be 'authenticated', the email must be confirmed, and there must be
-- a matching auth.identities row. An earlier version of this seed inserted only
-- (id, email) and produced four accounts that silently could not sign in.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  v.id::uuid,
  'authenticated',
  'authenticated',
  v.email,
  extensions.crypt('rasko-demo-2026', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', v.full_name),
  '', '', '', ''
from (values
  ('11111111-1111-4111-8111-111111111111', 'owner@raskosweetscent.example',      'Alice Tonui'),
  ('22222222-2222-4222-8222-222222222222', 'manager@raskosweetscent.example',    'Brian Mwangi'),
  ('33333333-3333-4333-8333-333333333333', 'accountant@raskosweetscent.example', 'Caroline Achieng'),
  ('44444444-4444-4444-8444-444444444444', 'sales@raskosweetscent.example',      'Daniel Kiplagat')
) as v(id, email, full_name)
on conflict (id) do nothing;

-- The identity row is what the password grant actually looks up.
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@raskosweetscent.example'
  and not exists (select 1 from auth.identities i where i.user_id = u.id)
on conflict do nothing;

insert into public.profiles (id, full_name, email, phone, role, is_active, must_change_password) values
  ('11111111-1111-4111-8111-111111111111', 'Alice Tonui',      'owner@raskosweetscent.example',      '+254712004501', 'owner',      true, false),
  ('22222222-2222-4222-8222-222222222222', 'Brian Mwangi',     'manager@raskosweetscent.example',    '+254712004502', 'manager',    true, false),
  ('33333333-3333-4333-8333-333333333333', 'Caroline Achieng', 'accountant@raskosweetscent.example', '+254712004503', 'accountant', true, false),
  ('44444444-4444-4444-8444-444444444444', 'Daniel Kiplagat',  'sales@raskosweetscent.example',      '+254712004504', 'sales',      true, false)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ settings

-- The row itself comes from migration 20260924000200; the demo fills it in.
update public.company_settings set
  address   = 'Kenyatta Avenue, Nakuru, Kenya',
  phone     = '+254712004500',
  email     = 'hello@raskosweetscent.example',
  kra_pin   = 'A000000001X'   -- invented; the real KRA PIN is PRD §12 open question 6
where id = '00000000-0000-0000-0000-000000000001';

insert into public.categories (id, name, slug, is_vatable, position) values
  ('ca000000-0000-4000-8000-000000000001', 'Fresh flowers',            'fresh_flowers', true, 1),
  ('ca000000-0000-4000-8000-000000000002', 'Arrangements & bouquets',  'arrangements',  true, 2),
  ('ca000000-0000-4000-8000-000000000003', 'Vases',                    'vases',         true, 3),
  ('ca000000-0000-4000-8000-000000000004', 'Accessories',              'accessories',   true, 4),
  ('ca000000-0000-4000-8000-000000000005', 'Other',                    'other',         true, 5)
on conflict (id) do nothing;

-- ------------------------------------------------------------------- clients

-- c...05 and c...06 are created by the SALES user, which is what makes the
-- FR-3.4 "own clients only" policy testable (docs/policy-tests.md §3).
insert into public.clients (id, name, client_type, phone, email, address, credit_terms_days, created_by) values
  ('c0000000-0000-4000-8000-000000000001', 'Lanet Gardens Hotel',        'corporate',     '+254712004518', 'events@lanetgardens.example',  'Lanet, Nakuru',        30, '22222222-2222-4222-8222-222222222222'),
  ('c0000000-0000-4000-8000-000000000002', 'Menengai Events & Planning', 'event_planner', '+254733901224', 'hello@menengaievents.example', 'Milimani, Nakuru',     30, '22222222-2222-4222-8222-222222222222'),
  ('c0000000-0000-4000-8000-000000000003', 'Rift Valley Sports Club',    'corporate',     '+254720443119', 'admin@rvsc.example',           'Nakuru West',           7, '11111111-1111-4111-8111-111111111111'),
  ('c0000000-0000-4000-8000-000000000004', 'Grace Wanjiru Kamau',        'individual',    '+254722187340', null,                           'Section 58, Nakuru',    0, '11111111-1111-4111-8111-111111111111'),
  ('c0000000-0000-4000-8000-000000000005', 'Peter Otieno Ochieng',       'individual',    '+254701556082', null,                           'Kiamunyi, Nakuru',      0, '44444444-4444-4444-8444-444444444444'),
  ('c0000000-0000-4000-8000-000000000006', 'Mercy Chebet Kiplagat',      'individual',    '+254745620371', null,                           'Free Area, Nakuru',     0, '44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

-- ------------------------------------------------------------------ products

insert into public.products (id, sku, name, category_id, unit, cost_price_cents, selling_price_cents, low_stock_threshold, created_by) values
  ('40000000-0000-4000-8000-000000000001', 'RSS-ROS-001', 'Red Naomi Rose',       'ca000000-0000-4000-8000-000000000001', 'stem',   2500,   6000, 200, '11111111-1111-4111-8111-111111111111'),
  ('40000000-0000-4000-8000-000000000002', 'RSS-ROS-002', 'Athena White Rose',    'ca000000-0000-4000-8000-000000000001', 'stem',   2300,   5500, 200, '11111111-1111-4111-8111-111111111111'),
  ('40000000-0000-4000-8000-000000000003', 'RSS-GYP-001', 'Gypsophila',           'ca000000-0000-4000-8000-000000000001', 'bundle',15000,  35000,  10, '11111111-1111-4111-8111-111111111111'),
  ('40000000-0000-4000-8000-000000000004', 'RSS-EUC-001', 'Eucalyptus Foliage',   'ca000000-0000-4000-8000-000000000001', 'bundle',12000,  28000,  12, '11111111-1111-4111-8111-111111111111'),
  ('40000000-0000-4000-8000-000000000005', 'RSS-ARR-001', 'Bridal Bouquet',       'ca000000-0000-4000-8000-000000000002', 'piece', 350000, 850000,   2, '11111111-1111-4111-8111-111111111111'),
  ('40000000-0000-4000-8000-000000000006', 'RSS-VAS-001', 'Ceramic Vase, medium', 'ca000000-0000-4000-8000-000000000003', 'piece',  80000, 180000,   5, '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

-- ----------------------------------------------------------------- suppliers

insert into public.suppliers (id, name, contact_person, phone, payment_terms_days, kra_pin, created_by) values
  ('50000000-0000-4000-8000-000000000001', 'Naivasha Rose Growers',      'Joseph Mwangi',    '+254711330947', 30, 'P000000011X', '11111111-1111-4111-8111-111111111111'),
  ('50000000-0000-4000-8000-000000000002', 'Molo Greens Limited',        'Esther Chepkorir', '+254728664201', 14, 'P000000012X', '11111111-1111-4111-8111-111111111111'),
  ('50000000-0000-4000-8000-000000000003', 'Nakuru Packaging Supplies',  'Daniel Kariuki',   '+254799118253',  7, 'P000000013X', '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

-- ------------------------------------------------------ purchases and stock

-- Marking a purchase `received` fires app.receive_purchase_into_stock, which
-- writes the purchase_in movements. Inserting as 'ordered' then updating is
-- deliberate: it exercises that trigger rather than bypassing it.
insert into public.purchases (id, supplier_id, status, purchase_date, due_date, created_by) values
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'ordered', date '2026-08-25', date '2026-09-24', '11111111-1111-4111-8111-111111111111'),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'ordered', date '2026-08-27', date '2026-09-10', '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

insert into public.purchase_items (id, purchase_id, product_id, quantity, unit_cost_cents) values
  ('61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 1000, 2500),
  ('61000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',  400, 2300),
  ('61000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003',   40, 15000),
  ('61000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000004',   30, 12000)
on conflict (id) do nothing;

update public.purchases
set status = 'received', received_at = timestamptz '2026-08-26 06:00:00+03',
    updated_by = '11111111-1111-4111-8111-111111111111'
where id = '60000000-0000-4000-8000-000000000001' and received_at is null;

update public.purchases
set status = 'received', received_at = timestamptz '2026-08-28 06:30:00+03',
    updated_by = '11111111-1111-4111-8111-111111111111'
where id = '60000000-0000-4000-8000-000000000002' and received_at is null;

insert into public.supplier_payments (id, purchase_id, amount_cents, method, reference, paid_at, created_by) values
  ('62000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', 500000, 'mpesa', 'SJ72KD91LM', timestamptz '2026-08-29 10:15:00+03', '33333333-3333-4333-8333-333333333333')
on conflict (id) do nothing;

-- Manual movements: a sale, some perishable wastage, and a stock-count
-- correction. Wastage and adjustment both carry a reason, as the CHECK requires.
insert into public.stock_movements (id, product_id, movement_type, quantity, unit_cost_cents, source_table, reason, occurred_at, created_by) values
  ('63000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'sale',      -160, 2500, 'manual', null,                                    timestamptz '2026-08-30 11:00:00+03', '44444444-4444-4444-8444-444444444444'),
  ('63000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'wastage',   -280, 2300, 'manual', 'Heat damage in transit from Naivasha',   timestamptz '2026-08-30 17:30:00+03', '22222222-2222-4222-8222-222222222222'),
  ('63000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004', 'wastage',    -26, 12000,'manual', 'Wilted, past usable life',               timestamptz '2026-08-31 08:00:00+03', '22222222-2222-4222-8222-222222222222'),
  ('63000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000006', 'adjustment',  -2, 80000,'manual', 'Stock count 31/08: two vases unaccounted for', timestamptz '2026-08-31 18:00:00+03', '11111111-1111-4111-8111-111111111111'),
  ('63000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000005', 'adjustment',   3, 350000,'manual','Opening stock of made-up bouquets',      timestamptz '2026-08-25 09:00:00+03', '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

-- -------------------------------------------------------------------- orders

-- order_number is assigned by app.assign_order_number; totals are rolled up by
-- app.refresh_order_totals from the line items below. Neither is hardcoded.
insert into public.orders (id, client_id, is_walk_in, status, order_type, delivery_at, delivery_address, taken_by, confirmed_at, created_by) values
  ('70000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', false, 'in_production', 'event',    timestamptz '2026-09-03 12:00:00+03', 'Menengai Crater Lodge',  '22222222-2222-4222-8222-222222222222', timestamptz '2026-08-31 09:00:00+03', '22222222-2222-4222-8222-222222222222'),
  ('70000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', false, 'confirmed',     'standard', timestamptz '2026-09-02 09:30:00+03', 'Lanet Gardens Hotel',    '44444444-4444-4444-8444-444444444444', timestamptz '2026-08-30 15:00:00+03', '44444444-4444-4444-8444-444444444444'),
  ('70000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004', false, 'delivered',     'standard', timestamptz '2026-08-30 14:00:00+03', 'Section 58, Nakuru',     '44444444-4444-4444-8444-444444444444', timestamptz '2026-08-29 10:00:00+03', '44444444-4444-4444-8444-444444444444'),
  ('70000000-0000-4000-8000-000000000004', null,                                   true,  'closed',        'standard', timestamptz '2026-08-29 17:15:00+03', null,                     '44444444-4444-4444-8444-444444444444', timestamptz '2026-08-29 17:00:00+03', '44444444-4444-4444-8444-444444444444'),
  ('70000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000006', false, 'draft',         'standard', timestamptz '2026-09-05 11:00:00+03', 'Free Area, Nakuru',      '44444444-4444-4444-8444-444444444444', null,                                 '44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

insert into public.order_items (id, order_id, product_id, description, quantity, unit_price_cents, position) values
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Red Naomi Rose',       1200, 6000, 1),
  ('71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'Gypsophila',             40, 35000, 2),
  ('71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000001', null,                                   'Stage arch, custom build', 1, 4500000, 3),
  ('71000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'Athena White Rose',     350, 5500, 1),
  ('71000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000006', 'Ceramic Vase, medium',    3, 180000, 2),
  ('71000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000005', 'Bridal Bouquet',          1, 450000, 1),
  ('71000000-0000-4000-8000-000000000007', '70000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', 'Red Naomi Rose',         20, 6000, 1),
  ('71000000-0000-4000-8000-000000000008', '70000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000004', 'Eucalyptus Foliage',      5, 28000, 1)
on conflict (id) do nothing;

-- ------------------------------------------------------ invoices & payments

-- invoice_number is allocated by app.assign_invoice_number for anything not in
-- draft. The draft row below deliberately has no number: that is the offline
-- case (architecture.md §8.2), and the invoices_issued_is_numbered CHECK is
-- what stops an unnumbered invoice ever being issued.
insert into public.invoices (id, order_id, client_id, status, issue_date, due_date,
                             subtotal_cents, total_cents, client_snapshot, company_snapshot, created_by) values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'issued', date '2026-08-31', date '2026-09-30', 12750000, 12750000,
   '{"name":"Menengai Events & Planning","phone":"+254733901224","address":"Milimani, Nakuru"}'::jsonb,
   '{"company_name":"Rasko Sweet Scent","kra_pin":"A000000001X"}'::jsonb, '22222222-2222-4222-8222-222222222222'),
  ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'issued', date '2026-08-28', date '2026-09-27',  6850000,  6850000,
   '{"name":"Lanet Gardens Hotel","phone":"+254712004518","address":"Lanet, Nakuru"}'::jsonb,
   '{"company_name":"Rasko Sweet Scent","kra_pin":"A000000001X"}'::jsonb, '44444444-4444-4444-8444-444444444444'),
  ('80000000-0000-4000-8000-000000000003', null,                                   'c0000000-0000-4000-8000-000000000003', 'issued', date '2026-08-19', date '2026-08-26',  3400000,  3400000,
   '{"name":"Rift Valley Sports Club","phone":"+254720443119"}'::jsonb,
   '{"company_name":"Rasko Sweet Scent","kra_pin":"A000000001X"}'::jsonb, '33333333-3333-4333-8333-333333333333'),
  ('80000000-0000-4000-8000-000000000004', null,                                   'c0000000-0000-4000-8000-000000000005', 'issued', date '2026-07-24', date '2026-08-08',   320000,   320000,
   '{"name":"Peter Otieno Ochieng","phone":"+254701556082"}'::jsonb,
   '{"company_name":"Rasko Sweet Scent","kra_pin":"A000000001X"}'::jsonb, '44444444-4444-4444-8444-444444444444'),
  ('80000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000006', 'draft',  date '2026-09-01', date '2026-09-01',   185000,   185000,
   '{"name":"Mercy Chebet Kiplagat","phone":"+254745620371"}'::jsonb,
   '{"company_name":"Rasko Sweet Scent","kra_pin":"A000000001X"}'::jsonb, '44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

-- Invoice 3 fully paid; invoice 2 partially paid; invoice 4 overdue and unpaid.
-- Two partial payments against one invoice exercise FR-5.4 (balance is a sum).
insert into public.payments (id, invoice_id, amount_cents, method, reference, paid_at, received_by, created_by) values
  ('90000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000003', 2000000, 'mpesa',         'SJ61MK22QP', timestamptz '2026-08-20 09:40:00+03', '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444'),
  ('90000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000003', 1400000, 'bank_transfer', 'FT26082612', timestamptz '2026-08-26 14:05:00+03', '33333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333'),
  ('90000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000002', 2000000, 'mpesa',         'SJ88TR40XZ', timestamptz '2026-08-29 16:20:00+03', '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

-- A cash payment recorded twice by mistake, corrected the only way the schema
-- allows: a reversal, never an edit or a delete (FR-5.5).
insert into public.payments (id, invoice_id, amount_cents, method, reference, paid_at, received_by, created_by) values
  ('90000000-0000-4000-8000-000000000004', '80000000-0000-4000-8000-000000000002', 150000, 'cash', 'Counter receipt 0142', timestamptz '2026-08-30 12:00:00+03', '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

insert into public.reversals (id, payment_id, amount_cents, reason, reversed_at, created_by) values
  ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004', 150000, 'Duplicate entry of counter receipt 0142', timestamptz '2026-08-30 12:40:00+03', '22222222-2222-4222-8222-222222222222')
on conflict (id) do nothing;

-- ------------------------------------------------------------------ payroll

-- National IDs and KRA/NSSF/SHIF numbers below are INVENTED placeholders in an
-- obviously synthetic pattern. They are not, and must never be replaced with,
-- real identity numbers in a shared environment.
insert into public.employees (id, profile_id, full_name, national_id, kra_pin, nssf_number, shif_number,
                              phone, position, salary_type, basic_pay_cents, allowances,
                              payment_method, payment_details, created_by) values
  ('e0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Brian Mwangi',     '30000001', 'A000000021X', 'NSSF-0001', 'SHIF-0001', '+254712004502', 'Shop manager',   'monthly', 6500000,
   '[{"code":"housing","label":"Housing","amount_cents":1500000},{"code":"transport","label":"Transport","amount_cents":600000}]'::jsonb,
   'mpesa', '{"phone":"+254712004502"}'::jsonb, '11111111-1111-4111-8111-111111111111'),
  ('e0000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'Daniel Kiplagat',  '30000002', 'A000000022X', 'NSSF-0002', 'SHIF-0002', '+254712004504', 'Sales assistant','monthly', 3800000,
   '[{"code":"transport","label":"Transport","amount_cents":400000}]'::jsonb,
   'mpesa', '{"phone":"+254712004504"}'::jsonb, '11111111-1111-4111-8111-111111111111'),
  ('e0000000-0000-4000-8000-000000000003', null,                                   'Faith Njeri Wairimu','30000003','A000000023X','NSSF-0003', 'SHIF-0003', '+254712004505', 'Florist',        'monthly', 3200000,
   '[]'::jsonb, 'mpesa', '{"phone":"+254712004505"}'::jsonb, '11111111-1111-4111-8111-111111111111'),
  ('e0000000-0000-4000-8000-000000000004', null,                                   'Samuel Ochieng Odoyo','30000004','A000000024X','NSSF-0004','SHIF-0004', '+254712004506', 'Delivery rider', 'daily',     120000,
   '[]'::jsonb, 'mpesa', '{"phone":"+254712004506"}'::jsonb, '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

insert into public.advances (id, employee_id, amount_cents, requested_at, requested_by, status, approved_at, approved_by, created_by) values
  ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 800000,
   timestamptz '2026-08-20 09:00:00+03', '22222222-2222-4222-8222-222222222222',
   'approved', timestamptz '2026-08-20 15:30:00+03', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222')
on conflict (id) do nothing;

-- A run left in `draft` on purpose: it is the state the accountant may edit and
-- the owner may approve, which is what docs/policy-tests.md §9 exercises.
insert into public.payroll_runs (id, period_year, period_month, status, prepared_at, prepared_by, rates_snapshot, created_by) values
  ('b0000000-0000-4000-8000-000000000001', 2026, 8, 'draft',
   timestamptz '2026-08-31 17:00:00+03', '33333333-3333-4333-8333-333333333333',
   (select jsonb_object_agg(kind, config) from public.statutory_rates where deleted_at is null),
   '33333333-3333-4333-8333-333333333333')
on conflict (id) do nothing;

insert into public.payroll_items (id, payroll_run_id, employee_id, employee_snapshot,
                                  basic_pay_cents, allowances, gross_cents,
                                  paye_cents, nssf_cents, shif_cents, housing_levy_cents,
                                  advance_deduction_cents, net_pay_cents) values
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   '{"full_name":"Brian Mwangi","kra_pin":"A000000021X","position":"Shop manager"}'::jsonb,
   6500000, '[{"code":"housing","amount_cents":1500000},{"code":"transport","amount_cents":600000}]'::jsonb, 8600000,
   1620000, 216000, 236500, 129000, 0, 6398500),
  ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   '{"full_name":"Daniel Kiplagat","kra_pin":"A000000022X","position":"Sales assistant"}'::jsonb,
   3800000, '[{"code":"transport","amount_cents":400000}]'::jsonb, 4200000,
   420000, 216000, 115500, 63000, 0, 3385500),
  ('b1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003',
   '{"full_name":"Faith Njeri Wairimu","kra_pin":"A000000023X","position":"Florist"}'::jsonb,
   3200000, '[]'::jsonb, 3200000,
   180000, 192000, 88000, 48000, 800000, 1892000)
on conflict (id) do nothing;

-- ------------------------------------------------------ website contact form

insert into public.website_contact_messages (id, name, email, phone, message, source_page) values
  ('d0000000-0000-4000-8000-000000000001', 'Janet Wambui', 'janet.wambui@example.com', '+254700111222',
   'Do you deliver bridal flowers to Naivasha on a Saturday?', '/contact')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- sanity out

do $$
declare v_stock numeric; v_balance bigint;
begin
  select current_stock into v_stock from public.product_stock
   where product_id = '40000000-0000-4000-8000-000000000001';
  select balance_cents into v_balance from public.invoice_balances
   where invoice_id = '80000000-0000-4000-8000-000000000002';
  raise notice 'Seed complete. Red Naomi Rose stock = % (1000 in, 160 sold). Invoice 2 balance = % cents.',
    v_stock, v_balance;
end $$;
