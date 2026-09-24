import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

// Fonts are self-hosted from @rasko/ui — the same files the app bundles.
// Never swap these for a CDN or next/font/google (docs/brand.md).
import '@rasko/ui/styles/all.css'
import './site.css'

import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { ScrollMotion } from '../components/motion/ScrollMotion'
import logo from '../../../docs/brand/logo.svg'
import { photos } from '../content/photos'
import { site } from '../content/site'

const heroPhoto = photos[site.hero.photo]
const shareWidth = heroPhoto.widths[heroPhoto.widths.length - 1] ?? heroPhoto.width

/**
 * Search and share metadata. The title leads with the brand so a search for
 * "Rasko Sweet Scent" lands here. Everything that needs an absolute address
 * (canonical link, share image) is added only once `site.url` is set; until
 * then Next would resolve it against localhost, which is worse than nothing.
 */
export const metadata: Metadata = {
  ...(site.url !== null ? { metadataBase: new URL(site.url), alternates: { canonical: '/' } } : {}),
  title: {
    default: site.seo.title,
    template: `%s | ${site.name}`,
  },
  description: site.seo.description,
  applicationName: site.name,
  robots: { index: true, follow: true },
  icons: { icon: { url: logo.src, type: 'image/svg+xml' } },
  openGraph: {
    title: site.seo.title,
    description: site.seo.description,
    siteName: site.name,
    locale: 'en_KE',
    type: 'website',
    ...(site.url !== null
      ? {
          url: '/',
          images: [
            {
              url: `/photos/${site.hero.photo}-${shareWidth}.webp`,
              width: shareWidth,
              height: Math.round((heroPhoto.height / heroPhoto.width) * shareWidth),
              alt: heroPhoto.alt,
            },
          ],
        }
      : {}),
  },
  twitter: {
    card: site.url !== null ? 'summary_large_image' : 'summary',
    title: site.seo.title,
    description: site.seo.description,
  },
}

export const viewport: Viewport = {
  themeColor: '#2D6A2F',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-KE">
      <body>
        {/* The header is fixed and the nav links jump down the page, so
            keyboard users need a way past it that does not involve tabbing
            through the whole bar on every jump. */}
        <a className="rw-skip" href="#main">
          Skip to content
        </a>

        <SiteHeader />

        <main id="main">{children}</main>

        <SiteFooter />

        {/* Renders nothing. Registers every scroll-linked tween on the page and
            tears them down on unmount. See components/motion/ScrollMotion.tsx. */}
        <ScrollMotion />
      </body>
    </html>
  )
}
