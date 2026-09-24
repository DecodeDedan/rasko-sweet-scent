-- ============================================================================
-- Reference rows a live system cannot run without.
--
-- These used to live only in supabase/seed.sql, beside invented demo data, so a
-- hosted project (where the seed never runs) started with no company settings,
-- no tax configuration and no statutory rates: settings had nothing to edit and
-- payroll could not prepare a run. They are configuration, not sample data, so
-- they belong in a migration. Every one is editable in Settings afterwards
-- (FR-9.1 – FR-9.3), and each insert leaves an existing row alone.
--
-- Categories are deliberately NOT inserted. The old seed's list was a
-- florist's (fresh flowers, vases), which is wrong for a cut-foliage grower
-- (PRD §12 q1). The owner or a manager creates them in Products > Categories.
-- ============================================================================

-- Only the name is known. Address, phone, KRA PIN and payment details print on
-- every invoice, so they stay empty until the owner enters the real ones
-- (PRD §12 q6) rather than printing an invented value.
insert into public.company_settings (id, company_name, is_vat_registered, stock_deduction_point)
values ('00000000-0000-0000-0000-000000000001', 'Rasko Sweet Scent', false, 'delivered')
on conflict (id) do nothing;

-- VAT off at 16%: docs/PROGRESS.md "Why VAT defaults to off".
insert into public.tax_config (is_vat_enabled, vat_rate_bp, effective_from)
select false, 1600, date '2026-01-01'
where not exists (select 1 from public.tax_config where deleted_at is null);

-- Kenyan statutory rates in force from 1 January 2026, monthly figures:
--   PAYE   Finance Act 2023 bands: 10% to 24,000; 25% to 32,333; 30% to
--          500,000; 32.5% to 800,000; 35% above. Personal relief 2,400.
--          NSSF, SHIF and the Housing Levy are deducted before PAYE
--          (Tax Laws (Amendment) Act 2024).
--   NSSF   NSSF Act 2013, year 4 limits from February 2025: 6% employee
--          share, lower limit 8,000, upper limit 72,000.
--   SHIF   2.75% of gross, minimum 300.
--   Levy   Affordable Housing Act 2024: 1.5% of gross, no cap.
-- The client's accountant confirms these against the first live payroll
-- (PRD §9). A change is a new row with its own effective date (FR-9.3).
insert into public.statutory_rates (kind, effective_from, config)
select v.kind, date '2026-01-01', v.config::jsonb
from (values
  ('paye', '{"personal_relief_cents": 240000,
             "deductions_before_tax": ["nssf", "shif", "housing_levy"],
             "bands": [{"upto_cents": 2400000,  "rate_bp": 1000},
                       {"upto_cents": 3233300,  "rate_bp": 2500},
                       {"upto_cents": 50000000, "rate_bp": 3000},
                       {"upto_cents": 80000000, "rate_bp": 3250},
                       {"upto_cents": null,     "rate_bp": 3500}]}'),
  ('nssf', '{"tier_1_cap_cents": 800000, "tier_2_cap_cents": 7200000, "rate_bp": 600}'),
  ('shif', '{"rate_bp": 275, "minimum_cents": 30000}'),
  ('housing_levy', '{"rate_bp": 150, "cap_cents": null}')
) as v (kind, config)
where not exists (
  select 1 from public.statutory_rates s where s.kind = v.kind and s.deleted_at is null
);
