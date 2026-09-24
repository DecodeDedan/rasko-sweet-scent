-- ============================================================================
-- The four varieties, and standard or spray.
--
-- Project owner, 2026-09-26: the farm grows four eucalyptus varieties, Baby
-- Blue, Gunni, Parvifolia and Globulus, and sells each of them as either a
-- standard stem or a spray. That supersedes the note in migration
-- 20260924000200 that categories were left for the owner to create: the
-- varieties are now confirmed facts, so they arrive as reference rows.
--
-- A variety is a product category (the `categories` table already groups
-- products, carries VAT applicability and orders the catalogue), so no second
-- table is added. The form is a property of the product: "Baby Blue, spray"
-- and "Baby Blue, standard" are two products with their own price and stock,
-- because they are priced, counted and sold separately.
--
-- Trade meanings, for the record and for client sign-off:
--   standard  one straight stem, leaf along its length
--   spray     a branched stem carrying side shoots
-- ============================================================================

insert into public.categories (name, slug, is_vatable, position)
select v.name, v.slug, true, v.position
from (values
  ('Baby Blue',  'baby_blue',  1),
  ('Gunni',      'gunni',      2),
  ('Parvifolia', 'parvifolia', 3),
  ('Globulus',   'globulus',   4)
) as v (name, slug, position)
-- A variety the owner already typed in by hand is kept, not duplicated.
where not exists (
  select 1 from public.categories c
   where lower(c.name) = lower(v.name) and c.deleted_at is null
)
and not exists (
  select 1 from public.categories c where c.slug = v.slug and c.deleted_at is null
);

alter table public.products
  add column stem_form text check (stem_form in ('standard', 'spray'));

comment on column public.products.stem_form is
  'Standard (one straight stem) or spray (branched, with side shoots). Null only for rows created before migration 20260926000100.';
