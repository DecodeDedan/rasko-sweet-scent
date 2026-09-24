import type { MetadataRoute } from 'next'

import { site } from '../content/site'

// Static export: generated once at build time into out/robots.txt.
export const dynamic = 'force-static'

/** Everything is public; the sitemap is advertised once the domain is known. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    ...(site.url !== null ? { sitemap: `${site.url}/sitemap.xml`, host: site.url } : {}),
  }
}
