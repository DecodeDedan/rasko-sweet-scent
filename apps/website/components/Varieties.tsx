import { PhotoCard } from './PhotoCard'
import { site } from '../content/site'
import type { Variety } from '../content/site'

/**
 * What the farm grows, which for now is Baby Blue alone.
 *
 * The text takes the first half of the `.rw-cards` grid and the photographs
 * take one card each, the same size as every other card on the page.
 */

const SPEC_LABELS = {
  stemLength: 'Stem length',
  bunchSize: 'Bunch',
  vaseLife: 'Vase life',
  availability: 'Available',
} as const

function Specification({ spec }: { spec: Variety['spec'] }) {
  const rows = (Object.keys(SPEC_LABELS) as (keyof typeof SPEC_LABELS)[]).flatMap((key) => {
    const value = spec[key]
    return value === null ? [] : [{ key, label: SPEC_LABELS[key], value }]
  })

  if (rows.length === 0) return null

  return (
    <dl className="rw-spec">
      {rows.map((row) => (
        <div className="rw-spec__row" key={row.key}>
          <dt className="rw-spec__label">{row.label}</dt>
          <dd className="rw-spec__value">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Varieties() {
  const { specimen } = site

  return (
    <section className="rw-container rw-section" id="what-we-grow">
      <div className="rw-rule rw-section__rule" />

      <div className="rw-cards">
        <div className="rw-cards__lead">
          <h2 className="rw-display-2">{site.varieties.heading}</h2>
          <p className="rw-lede">{site.varieties.intro}</p>

          {site.varieties.items.map((variety) => (
            <div className="rw-variety__body" key={variety.label}>
              <h3 className="rw-display-3 rw-variety__name">
                {variety.tradeName ?? variety.label}
              </h3>
              {variety.botanicalName !== null ? (
                <p className="rw-variety__botanical">{variety.botanicalName}</p>
              ) : null}
              <p className="rw-body rw-variety__description">{variety.description}</p>
              <Specification spec={variety.spec} />
            </div>
          ))}
        </div>

        {site.varieties.items.map((variety) => (
          <PhotoCard className="rw-reveal" photo={variety.photo} key={variety.label}>
            <h3 className="rw-card__title">{variety.tradeName ?? variety.label}</h3>
            <p className="rw-card__text">Round leaves set in opposite pairs along every stem.</p>
          </PhotoCard>
        ))}

        <PhotoCard className="rw-reveal" photo={specimen.photo}>
          <h3 className="rw-card__title">One stem</h3>
          <p className="rw-card__text">{specimen.caption}</p>
        </PhotoCard>
      </div>
    </section>
  )
}
