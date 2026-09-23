import { site } from '../content/site'

/** Copies of the name run laid end to end, so the scrub never shows an edge. */
const COPIES = 4

/**
 * A band of the variety names in display type, moved sideways by the scroll
 * (components/motion/ScrollMotion.tsx, `.rw-band__track`).
 *
 * Decorative and hidden from assistive technology: every name here already
 * appears as a heading in the section above, and reading it four times over
 * would be noise.
 */
export function VarietyBand() {
  const names = site.varieties.items.flatMap((variety) => [
    variety.tradeName ?? variety.label,
    ...(variety.botanicalName !== null ? [variety.botanicalName] : []),
  ])

  return (
    <div className="rw-band" aria-hidden="true">
      <div className="rw-band__track">
        {Array.from({ length: COPIES }, (_, copy) =>
          names.map((name, index) => (
            <span
              className={index % 2 === 0 ? 'rw-band__word' : 'rw-band__word rw-band__word--outline'}
              key={`${copy}-${name}`}
            >
              {name}
            </span>
          )),
        )}
      </div>
    </div>
  )
}
