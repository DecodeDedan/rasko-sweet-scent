'use client'

import { motion, useScroll } from 'framer-motion'

import logo from '../../../docs/brand/logo.svg'
import { site } from '../content/site'

/**
 * Fixed header, solid white at every scroll position so it reads as the one
 * white bar above a green page.
 *
 * Framer Motion's `useScroll` drives the reading-progress line along its foot,
 * writing straight to the DOM node, so scrolling never re-renders React.
 */
export function SiteHeader() {
  const { scrollYProgress } = useScroll()

  return (
    <header className="rw-header">
      <div className="rw-container rw-header__inner">
        <a className="rw-wordmark" href="#top">
          {/* Decorative: the name beside it is the accessible label. */}
          <img className="rw-wordmark__mark" src={logo.src} width={logo.width} height={logo.height} alt="" />
          <span>{site.name}</span>
        </a>

        <nav className="rw-header__nav" aria-label="Sections">
          <a className="rw-link" href="#what-we-grow">
            What we grow
          </a>
          <a className="rw-link" href="#the-farm">
            The farm
          </a>
        </nav>
      </div>

      {/* How far through the page the reader is, drawn along the header's foot. */}
      <motion.div className="rw-header__progress" style={{ scaleX: scrollYProgress }} aria-hidden="true" />
    </header>
  )
}
