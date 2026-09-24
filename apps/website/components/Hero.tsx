'use client'

import { Fragment } from 'react'
import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { motion, useReducedMotion } from 'framer-motion'

import { Plate } from './Plate'
import { site } from '../content/site'
import { ENTER_BEZIER } from '../lib/motion'
import { whatsappLink } from '../lib/whatsapp'

/**
 * three.js loads after first paint; the hero is complete without it. No
 * placeholder is needed because the canvas is absolutely positioned and
 * takes no space in the layout.
 */
const LeafDrift = dynamic(() => import('./LeafDrift').then((module) => module.LeafDrift), {
  ssr: false,
})

type Props = {
  /** The inline monogram, rendered on the server (components/BrandMark.tsx). */
  brand: ReactNode
}

/**
 * The brand block leads: the monogram and the slogan, both drawn in by GSAP
 * on load (components/motion/ScrollMotion.tsx), over leaves falling in
 * three.js (components/LeafDrift.tsx).
 *
 * Below it, the headline and standfirst are Framer Motion's entrance, Everything below the hero waits to be scrolled to and is driven by
 * GSAP instead (components/motion/ScrollMotion.tsx).
 *
 * Four beats: the headline rises out of its mask, the standfirst follows, then
 * the actions, then the photograph. The stagger is carried by `delay` rather
 * than a parent variant because the four elements are not siblings in the DOM.
 *
 * The headline sits inside an overflow-hidden heading and the span is what
 * translates within it, so the type appears to rise out of the page rather than
 * slide over it. Letting it wrap naturally with text-wrap: balance, rather than
 * hand-breaking the lines, keeps it from stranding a word at an awkward width.
 */
export function Hero({ brand }: Props) {
  const enquire = whatsappLink(site.contact.whatsapp, site.enquiry.prefill)
  const reduced = useReducedMotion()

  // `false` skips the initial state entirely rather than animating a
  // zero-length tween into it, so under reduced motion nothing is ever
  // rendered displaced, not even for one frame.
  const fade = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, delay, ease: ENTER_BEZIER },
        }

  return (
    <section className="rw-container rw-hero" id="top">
      <LeafDrift className="rw-hero__leaves" />

      {/* The page's one h1: the brand and the slogan. The name is given as
          text (visually hidden, beside the mark that shows it), because a
          search for "Rasko Sweet Scent" should match the page's main heading
          and search engines read text more reliably than an SVG label. */}
      <h1 className="rw-hero__brand">
        <span className="rw-sr-only">{site.name}: </span>
        {brand}
        <span className="rw-hero__slogan">{site.slogan}</span>
      </h1>

      <p className="rw-display-2 rw-hero__headline">
        <motion.span
          initial={reduced ? false : { y: '110%' }}
          animate={{ y: 0 }}
          transition={{ duration: 1.1, ease: ENTER_BEZIER }}
        >
          {/* One span per word so GSAP can run the colour wave across them
              (components/motion/ScrollMotion.tsx). Framer Motion moves the
              parent span; GSAP only ever touches the words' colour. */}
          {site.hero.headline.split(' ').map((word, index) => (
            <Fragment key={`${index}-${word}`}>
              {index > 0 ? ' ' : null}
              <span className="rw-hero__word">{word}</span>
            </Fragment>
          ))}
        </motion.span>
      </p>

      <div className="rw-hero__deck">
        <motion.p className="rw-lede" {...fade(0.22)}>
          {site.hero.standfirst}
        </motion.p>

        <motion.div className="rw-hero__actions" {...fade(0.36)}>
          {/* No number yet: no button, rather than a disabled one saying so. */}
          {enquire === null ? null : (
            <motion.a
              className="rw-button"
              href={enquire}
              target="_blank"
              rel="noopener noreferrer"
              // Spread rather than pass `undefined`: under
              // exactOptionalPropertyTypes an explicit undefined is not the
              // same as an absent prop, and Framer Motion's types say so.
              {...(reduced ? {} : { whileHover: { y: -2 }, whileTap: { y: 0, scale: 0.98 } })}
              transition={{ duration: 0.2, ease: ENTER_BEZIER }}
            >
              Enquire on WhatsApp
            </motion.a>
          )}

          <a className="rw-link" href="#what-we-grow">
            See what we grow
          </a>
        </motion.div>
      </div>

      {/*
       * Deliberately NOT animated in.
       *
       * This photograph is the page's Largest Contentful Paint element. Giving
       * it an `initial={{ opacity: 0 }}` means it stays invisible until the
       * bundle has downloaded, parsed and hydrated: measured at 1,205ms of pure
       * render delay on a local server with no throttling, and far worse on the
       * mobile connections these buyers are actually on. A fade nobody asked
       * for is not worth a second of blank hero.
       *
       * It still moves: GSAP drifts it against the page as you scroll
       * (components/motion/ScrollMotion.tsx), which costs nothing at load
       * because it only starts once the element is already painted.
       */}
      <div className="rw-hero__plate">
        <Plate
          photo={site.hero.photo}
          shape="wide"
          focusSky
          priority
          sizes="(min-width: 76rem) 72rem, 100vw"
        />
      </div>
    </section>
  )
}
