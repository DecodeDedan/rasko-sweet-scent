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
import { site } from '../content/site'

export const metadata: Metadata = {
  title: {
    default: `${site.name}, eucalyptus foliage from Nakuru`,
    template: `%s, ${site.name}`,
  },
  description: site.summary,
  icons: { icon: { url: logo.src, type: 'image/svg+xml' } },
  openGraph: {
    title: `${site.name}, eucalyptus foliage from Nakuru`,
    description: site.summary,
    locale: 'en_KE',
    type: 'website',
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
