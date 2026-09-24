import { site } from '../content/site'

/**
 * Schema.org JSON-LD for the home page: who the business is and where.
 *
 * Built only from content/site.ts, and every unconfirmed fact is simply left
 * out, so the markup never states more than the page does (Google treats
 * structured data that contradicts the visible page as spam). Fields that
 * need an absolute address (`url`, `logo`, `image`) appear once `site.url`
 * is set.
 */

type JsonLd = Record<string, unknown>

/** Google Maps search for the farm's area, the same place the map card shows. */
function mapUrl(): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.location.mapQuery)}`
}

export function homeJsonLd(logoPath: string, imagePath: string): JsonLd {
  const { location, contact, url } = site
  const absolute = url === null ? null : { url, logo: `${url}${logoPath}`, image: `${url}${imagePath}` }

  const business: JsonLd = {
    '@type': 'LocalBusiness',
    '@id': `${url ?? ''}/#business`,
    name: site.name,
    slogan: site.slogan,
    description: site.seo.description,
    knowsAbout: site.seo.topics,
    address: {
      '@type': 'PostalAddress',
      ...(location.area !== null ? { addressLocality: location.area } : {}),
      addressRegion: location.county,
      addressCountry: 'KE',
    },
    areaServed: { '@type': 'Country', name: location.country },
    hasMap: mapUrl(),
    ...(contact.email !== null ? { email: contact.email } : {}),
    ...(contact.phoneDisplay !== null ? { telephone: contact.phoneDisplay } : {}),
    ...(absolute ?? {}),
  }

  const website: JsonLd = {
    '@type': 'WebSite',
    name: site.name,
    ...(url !== null ? { url } : {}),
    publisher: { '@id': `${url ?? ''}/#business` },
  }

  return { '@context': 'https://schema.org', '@graph': [business, website] }
}

/**
 * Serialise for a <script type="application/ld+json">. `<` is escaped so no
 * string in the content can close the script element early.
 */
export function serialiseJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
