# Search visibility

What the website does in code, and what only the business can do outside it.
No one can guarantee a first-place result; these steps are what earns one.

## Done in the site (apps/website)

- Title `Rasko Sweet Scent | Baby Blue Eucalyptus Foliage, Kenya` and a
  158-character description naming Baby Blue, eucalyptus, foliage, Molo,
  Nakuru County and Kenya (`content/site.ts`, `seo`).
- One `h1`: "Rasko Sweet Scent: All that nature gives."
- schema.org JSON-LD: `LocalBusiness` (name, slogan, Molo / Nakuru County /
  KE address, map link, topics) and `WebSite` (`lib/structuredData.ts`).
- `robots.txt` and `sitemap.xml`, Open Graph and Twitter cards.
- Fast static pages; the heavy three.js code loads after first paint.

## Needs one fact: the domain

Set `url` in `apps/website/content/site.ts` (for example
`https://raskosweetscent.co.ke`). That single change switches on the canonical
link, the sitemap entries, the share image and the JSON-LD `url` and `logo`.

## Only the business can do these (in order of impact)

1. **Google Business Profile** at business.google.com. Category "Farm" or
   "Wholesale florist supplier", the Molo address, phone, hours, photos of
   the crop. This decides the map results for "eucalyptus near Nakuru" and
   shows the brand panel for "Rasko Sweet Scent". Verification is by post or
   phone to the business.
2. **Google Search Console** at search.google.com/search-console. Verify the
   domain, submit `https://<domain>/sitemap.xml`, request indexing of `/`.
   Do the same once in Bing Webmaster Tools.
3. **Consistent name, address, phone** everywhere: exactly "Rasko Sweet
   Scent", the same Molo address and number on the Business Profile, the site
   and every listing.
4. **Links from relevant sites**: Kenya Flower Council and horticulture
   directories, Kenyan business directories, florists and decorators you
   supply (a "stems from Rasko Sweet Scent" credit on their site is worth
   more than any number of generic listings).
5. **Social profiles** (Facebook, Instagram, LinkedIn) under the same name,
   linking to the site. Add their URLs to the JSON-LD `sameAs` once they exist.
6. **Reviews** from buyers on the Business Profile.

## Realistic expectations

- "Rasko Sweet Scent": top result within days to weeks of indexing; the name
  is distinctive.
- "Baby Blue eucalyptus Kenya", "eucalyptus foliage Nakuru", "cut foliage
  supplier Molo": achievable top-3 with the Business Profile and a few links.
- Broad terms like "floral business" or "eucalyptus flowers" are fought over
  worldwide by large retailers and publishers; one farm page will not own
  them. The site does not claim to sell flowers, because it does not: it
  sells foliage, and saying otherwise would draw visitors who leave.
