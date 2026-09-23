'use client'

import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { site } from '../content/site'
import { prefersReducedMotion } from '../lib/motion'

/**
 * three.js is the heaviest thing on the page and this section sits below the
 * hero, so it loads after first paint rather than in the first-load bundle.
 * The canvas box is sized in CSS, so nothing shifts when it arrives.
 */
const StemCanvas = dynamic(() => import('./StemCanvas').then((module) => module.StemCanvas), {
  ssr: false,
  // Same box as the canvas, so the pinned section's height (which GSAP
  // measures) is identical before and after three.js arrives.
  loading: () => <div className="rw-study__canvas" aria-hidden="true" />,
})

/** Viewport heights of scroll the section stays pinned for, per note. */
const SCROLL_PER_NOTE = 90
/** Scrub smoothing in seconds: long enough to feel weighted, short enough to track. */
const SCRUB = 0.8

/**
 * The lead variety, pinned to the screen while the reader scrolls through it.
 *
 * GSAP owns the scroll here: one ScrollTrigger pins the section, scrubs a
 * timeline that hands the notes off one to the next, fills the meter, and
 * writes its progress into a ref that the three.js stem reads every frame.
 * One source of progress is what keeps the text and the 3D in step.
 *
 * WITHOUT SCRIPT, OR WITH REDUCED MOTION
 * The notes are an ordinary list, stacked and all visible. Only once the
 * timeline exists does `is-staged` lay them on top of each other and GSAP
 * hide all but the first, so the stylesheet never holds a hidden state.
 */
export function StemStudy() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const notesRef = useRef<HTMLOListElement | null>(null)
  const progress = useRef(0)

  const variety = site.varieties.items[0]
  const { eyebrow, notes } = site.study

  useEffect(() => {
    const section = sectionRef.current
    const list = notesRef.current
    if (section === null || list === null || prefersReducedMotion()) return

    gsap.registerPlugin(ScrollTrigger)

    const ctx = gsap.context(() => {
      const items = gsap.utils.toArray<HTMLElement>('.rw-study__note', list)
      list.classList.add('is-staged')
      gsap.set(items.slice(1), { autoAlpha: 0, y: 28 })

      const timeline = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: `+=${items.length * SCROLL_PER_NOTE}%`,
          pin: true,
          scrub: SCRUB,
          // Measured before every other trigger: the pin adds scroll length
          // that everything below it depends on.
          refreshPriority: 1,
          onUpdate: (self) => {
            progress.current = self.progress
          },
        },
      })

      items.forEach((item, index) => {
        const previous = items[index - 1]
        if (previous === undefined) return
        timeline
          .to(previous, { autoAlpha: 0, y: -28, duration: 0.3 }, index - 0.35)
          .to(item, { autoAlpha: 1, y: 0, duration: 0.3 }, index - 0.2)
      })
      // Hold on the last note so it is read before the pin lets go.
      timeline.to({}, { duration: 0.6 })

      timeline.fromTo(
        '.rw-study__meter span',
        { scaleX: 0 },
        { scaleX: 1, ease: 'none', duration: timeline.duration() },
        0,
      )

      gsap.from('.rw-study__name', {
        yPercent: 40,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: section, start: 'top 75%', once: true },
      })
    }, section)

    // The pin changes the page height; every other trigger re-measures.
    const frame = requestAnimationFrame(() => ScrollTrigger.refresh())

    return () => {
      cancelAnimationFrame(frame)
      ctx.revert()
      list.classList.remove('is-staged')
    }
  }, [])

  if (variety === undefined) return null

  return (
    <section ref={sectionRef} className="rw-study" aria-labelledby="study-heading">
      <div className="rw-container rw-study__inner">
        <div className="rw-study__text">
          <p className="rw-study__eyebrow">{eyebrow}</p>
          <h2 id="study-heading" className="rw-display-1 rw-study__name">
            {variety.tradeName ?? variety.label}
          </h2>
          {variety.botanicalName !== null ? (
            <p className="rw-study__botanical">{variety.botanicalName}</p>
          ) : null}

          <ol ref={notesRef} className="rw-study__notes">
            {notes.map((note) => (
              <li className="rw-study__note" key={note.title}>
                <h3>{note.title}</h3>
                <p>{note.body}</p>
              </li>
            ))}
          </ol>

          <div className="rw-study__meter" aria-hidden="true">
            <span />
          </div>
        </div>

        <StemCanvas className="rw-study__canvas" progress={progress} />
      </div>
    </section>
  )
}
