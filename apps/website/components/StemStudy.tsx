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

/** Viewport heights of scroll the section stays pinned for, per variety. */
const SCROLL_PER_VARIETY = 95
/** Scrub smoothing in seconds: long enough to feel weighted, short enough to track. */
const SCRUB = 0.8
/**
 * Pinning needs the whole section to fit on one screen. On a phone the text
 * and the stem stack and are taller than the viewport (measured: 1049px on a
 * 700px screen), so there the section scrolls normally and the stem sticks.
 * Matches the CSS breakpoint and StemCanvas's WIDE_FROM.
 */
const PIN_FROM = '(min-width: 56rem)'

/**
 * The four varieties, pinned to the screen while the reader scrolls through
 * them one after another. The stem beside the text reshapes to each variety's
 * leaf as its panel arrives.
 *
 * GSAP owns the scroll here: one ScrollTrigger pins the section, scrubs a
 * timeline that hands the panels off one to the next, fills the meter, and
 * writes its progress into a ref that the three.js stem reads every frame.
 * One source of progress is what keeps the text and the 3D in step: progress
 * 0 to 1 spans the varieties in order, and StemCanvas maps it the same way.
 *
 * ON A PHONE
 * No pin. The panels scroll past as a list while the stem stays stuck above
 * them (CSS sticky), and the same progress ref, taken from the section's own
 * scroll, reshapes it as each variety goes by.
 *
 * WITHOUT SCRIPT, OR WITH REDUCED MOTION
 * The panels are an ordinary list, stacked and all visible. Only once the
 * timeline exists does `is-staged` lay them on top of each other and GSAP
 * hide all but the first, so the stylesheet never holds a hidden state.
 */
export function StemStudy() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const panelsRef = useRef<HTMLOListElement | null>(null)
  const progress = useRef(0)

  const varieties = site.varieties.items
  const { forms } = site.varieties
  const { eyebrow } = site.study

  useEffect(() => {
    const section = sectionRef.current
    const list = panelsRef.current
    if (section === null || list === null || prefersReducedMotion()) return

    gsap.registerPlugin(ScrollTrigger)

    const media = gsap.matchMedia(section)

    media.add(PIN_FROM, () => {
      const panels = gsap.utils.toArray<HTMLElement>('.rw-study__panel', list)
      list.classList.add('is-staged')
      gsap.set(panels.slice(1), { autoAlpha: 0, y: 36 })

      const timeline = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: `+=${panels.length * SCROLL_PER_VARIETY}%`,
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

      panels.forEach((panel, index) => {
        const previous = panels[index - 1]
        if (previous === undefined) return
        timeline
          .to(previous, { autoAlpha: 0, y: -36, duration: 0.3 }, index - 0.35)
          .to(panel, { autoAlpha: 1, y: 0, duration: 0.3 }, index - 0.2)
          .from(
            panel.querySelectorAll('.rw-study__note'),
            { autoAlpha: 0, y: 14, stagger: 0.08, duration: 0.25 },
            index - 0.1,
          )
      })
      // Hold on the last variety so it is read before the pin lets go.
      timeline.to({}, { duration: 0.6 })

      timeline.fromTo(
        '.rw-study__meter-fill',
        { scaleX: 0 },
        { scaleX: 1, ease: 'none', duration: timeline.duration() },
        0,
      )

      gsap.from('.rw-study__panel:first-child .rw-study__name', {
        yPercent: 40,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: section, start: 'top 75%', once: true },
      })

      return () => list.classList.remove('is-staged')
    })

    media.add(`not all and ${PIN_FROM}`, () => {
      ScrollTrigger.create({
        trigger: list,
        // The stem reshapes as each panel crosses the middle of the screen.
        start: 'top 55%',
        end: 'bottom 55%',
        scrub: true,
        onUpdate: (self) => {
          progress.current = self.progress
        },
      })
    })

    // The pin changes the page height; every other trigger re-measures.
    const frame = requestAnimationFrame(() => ScrollTrigger.refresh())

    return () => {
      cancelAnimationFrame(frame)
      media.revert()
    }
  }, [])

  if (varieties.length === 0) return null

  return (
    <section ref={sectionRef} className="rw-study" aria-labelledby="study-heading">
      <div className="rw-container rw-study__inner">
        <div className="rw-study__text">
          <h2 id="study-heading" className="rw-study__eyebrow">
            {eyebrow}
          </h2>

          <ol ref={panelsRef} className="rw-study__panels">
            {varieties.map((variety, index) => (
              <li className="rw-study__panel" key={variety.label}>
                <p className="rw-study__count" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')} / {String(varieties.length).padStart(2, '0')}
                </p>
                <h3 className="rw-display-1 rw-study__name">
                  {variety.tradeName ?? variety.label}
                </h3>
                {variety.botanicalName !== null ? (
                  <p className="rw-study__botanical">{variety.botanicalName}</p>
                ) : null}

                <p className="rw-study__forms">
                  <span className="rw-visually-hidden">Cut as </span>
                  {variety.forms.map((form) => (
                    <span className="rw-study__form" key={form}>
                      {forms[form].name}
                    </span>
                  ))}
                </p>

                <ul className="rw-study__notes">
                  {variety.study.map((note) => (
                    <li className="rw-study__note" key={note.title}>
                      <h4>{note.title}</h4>
                      <p>{note.body}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <div className="rw-study__meter" aria-hidden="true">
            <span className="rw-study__meter-fill" />
            {varieties.slice(1).map((variety, index) => (
              <span
                className="rw-study__meter-tick"
                key={variety.label}
                style={{ left: `${((index + 1) / varieties.length) * 100}%` }}
              />
            ))}
          </div>
        </div>

        <StemCanvas className="rw-study__canvas" progress={progress} count={varieties.length} />
      </div>
    </section>
  )
}
