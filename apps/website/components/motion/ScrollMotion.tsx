'use client'

import { useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { ENTER_EASE, prefersReducedMotion } from '../../lib/motion'

/**
 * Every scroll-linked effect on the page, in one place.
 *
 * Renders nothing. It is mounted once from the layout and drives the existing
 * markup by class name, so the section components stay server-rendered and free
 * of animation concerns.
 *
 * WHY THE FROM-STATE LIVES HERE AND NOT IN CSS
 * The obvious way to build a reveal is to hide the element in the stylesheet
 * and let script bring it back. That ships a page whose content is invisible to
 * anyone the script never reaches: scripting off, a bundle that failed to load,
 * a crawler that does not execute it. Because `gsap.from()` writes the hidden
 * state at runtime, the stylesheet holds no hidden state at all, and a visitor
 * with no JavaScript gets the whole page with no animation. The animation is an
 * enhancement; the content never depends on it.
 *
 * Everything below animates transform and opacity only, so it stays on the
 * compositor and cannot block the main thread during a scroll.
 */
/**
 * The hero headline's colour cycle, in order, returning to white so the loop
 * joins without a jump. Asked for by the project owner (2026-09-23) and an
 * exception to the green/white/black palette in docs/brand.md.
 *
 * Every colour is a light tint, never a saturated hue, because the headline
 * sits on Rasko Green #2D6A2F: a true red there measures under 2:1 and cannot
 * be read. Contrast against #2D6A2F, all above the 3:1 floor for large text:
 *   white 6.4, green #B7F5A8 5.0, gold #FFE08A 5.0, blue #B5E2FF 4.6,
 *   coral red #FFB1A3 3.6.
 */
const HEADLINE_COLOURS = ['#B7F5A8', '#FFB1A3', '#B5E2FF', '#FFE08A', '#FFFFFF'] as const
/** Seconds each colour takes to arrive, and the gap before the next wave starts. */
const COLOUR_DURATION = 0.9
const COLOUR_HOLD = 1.4
/** Seconds between neighbouring words, so each colour runs across the line as a wave. */
const COLOUR_STAGGER = 0.09

export function ScrollMotion() {
  useEffect(() => {
    if (prefersReducedMotion()) return

    gsap.registerPlugin(ScrollTrigger)

    // gsap.context scopes every tween and trigger created inside it, so the
    // single revert() below tears all of them down. Without it, ScrollTriggers
    // survive re-mounts and accumulate.
    const ctx = gsap.context(() => {
      /* --- Photographs drift against the page ------------------------------
       * The image is held oversize so there is headroom to move it inside its
       * frame without exposing an edge: 1.12 scale gives 6% of slack top and
       * bottom, and the travel below spends 5% of it. */
      gsap.utils.toArray<HTMLElement>('.rw-plate').forEach((plate) => {
        const image = plate.querySelector('img')
        if (image === null) return

        gsap.set(image, { scale: 1.12, willChange: 'transform' })
        gsap.fromTo(
          image,
          { yPercent: -5 },
          {
            yPercent: 5,
            ease: 'none',
            scrollTrigger: {
              trigger: plate,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.6,
            },
          },
        )
      })

      /* --- Blocks arrive ---------------------------------------------------
       * once: true, because a reveal that replays every time you scroll past
       * turns a page into an aquarium. */
      gsap.utils.toArray<HTMLElement>('.rw-reveal').forEach((block) => {
        gsap.from(block, {
          opacity: 0,
          y: 32,
          duration: 0.9,
          ease: ENTER_EASE,
          scrollTrigger: { trigger: block, start: 'top 88%', once: true },
        })
      })

      /* --- Rules are drawn, not switched on -------------------------------- */
      gsap.utils.toArray<HTMLElement>('.rw-rule').forEach((rule) => {
        gsap.from(rule, {
          scaleX: 0,
          transformOrigin: 'left center',
          duration: 1,
          ease: ENTER_EASE,
          scrollTrigger: { trigger: rule, start: 'top 92%', once: true },
        })
      })

      /* --- The headline lifts away faster than the page ------------------
       * GSAP moves the heading; Framer Motion owns the span inside it (the
       * load-time rise), so the two never touch the same element. */
      gsap.to('.rw-hero__headline', {
        yPercent: -45,
        ease: 'none',
        scrollTrigger: { trigger: '.rw-hero', start: 'top top', end: 'bottom top', scrub: true },
      })

      /* --- The headline cycles through colour, word by word -------------
       * A looping timeline, played only while the hero is on screen: a loop
       * nobody can see still costs a repaint every frame. Colour, unlike the
       * rest of this file, is not a compositor property, but it repaints
       * eight words of text and nothing else. */
      const words = gsap.utils.toArray<HTMLElement>('.rw-hero__word')
      if (words.length > 0) {
        const colours = gsap.timeline({ repeat: -1, paused: true })
        HEADLINE_COLOURS.forEach((colour, index) => {
          colours.to(
            words,
            {
              color: colour,
              duration: COLOUR_DURATION,
              ease: 'sine.inOut',
              stagger: COLOUR_STAGGER,
            },
            index * (COLOUR_DURATION + COLOUR_HOLD),
          )
        })
        ScrollTrigger.create({
          trigger: '.rw-hero',
          start: 'top bottom',
          end: 'bottom top',
          onToggle: (self) => (self.isActive ? colours.play() : colours.pause()),
        })
      }

      /* --- The variety band runs sideways with the scroll ------------------
       * One copy of the four is a quarter of the track, so travelling 25%
       * never exposes the end. Direction alternates with scroll direction for
       * free, because scrub maps position, not time. */
      gsap.utils.toArray<HTMLElement>('.rw-band__track').forEach((track) => {
        gsap.fromTo(
          track,
          { xPercent: 0 },
          {
            xPercent: -25,
            ease: 'none',
            scrollTrigger: { trigger: track, start: 'top bottom', end: 'bottom top', scrub: 0.4 },
          },
        )
      })

      /* --- The four process steps arrive in their own order ----------------
       * The one stagger on the page, and it is here because the content is
       * genuinely a sequence: cut, sort, tie, hold. The steps must not also
       * carry `.rw-reveal`: two from() tweens on one element leave the second
       * reading the first's hidden start as its end state, stuck invisible. */
      const steps = gsap.utils.toArray<HTMLElement>('.rw-process > li')
      const firstStep = steps[0]
      if (firstStep !== undefined) {
        gsap.from(steps, {
          opacity: 0,
          y: 40,
          duration: 0.8,
          ease: ENTER_EASE,
          stagger: 0.12,
          scrollTrigger: { trigger: firstStep, start: 'top 85%', once: true },
        })
      }
    })

    // Fonts and lazy images settle after first paint and change element
    // heights, which leaves every trigger holding a stale measurement.
    const refresh = () => ScrollTrigger.refresh()
    document.fonts?.ready.then(refresh).catch(() => undefined)
    window.addEventListener('load', refresh)

    return () => {
      window.removeEventListener('load', refresh)
      ctx.revert()
    }
  }, [])

  return null
}
