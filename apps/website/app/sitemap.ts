import type { MetadataRoute } from 'next'

import { site } from '../content/site'

// Static export: generated once at build time into out/sitemap.xml.
export const dynamic = 'force-static'

/**
 * The two public pages. Sitemap entries must be absolute URLs, so the list is
 * empty until `site.url` is confirmed; an empty sitemap is valid, a sitemap
 * of relative paths is not.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (site.url === null) return []
  return [
    { url: `${site.url}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${site.url}/privacy/`, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
