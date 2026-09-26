-- ============================================================================
-- Invoice letterhead details (FR-5.2, FR-9.1).
--
-- The owner supplied the email and KRA PIN printed on every invoice
-- (2026-09-26). Address and phone come from the company's paper invoice book
-- and are filled only where nothing has been entered yet, so a value already
-- set in Settings is never overwritten. All four stay editable in Settings.
-- ============================================================================

update public.company_settings
set email   = 'info@raskosweetscent.com',
    kra_pin = 'P052533612T',
    address = coalesce(address, 'Nyota Farm, Molo'),
    phone   = coalesce(phone, '+254700339635')
where id = '00000000-0000-0000-0000-000000000001';
