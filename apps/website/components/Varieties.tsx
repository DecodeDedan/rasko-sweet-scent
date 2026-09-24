import { PhotoCard } from './PhotoCard'
import { site } from '../content/site'
import type { Variety } from '../content/site'

/**
 * What the farm grows: one card per variety, the same size as every other
 * card on the page. The section text spans the full row above them, so the
 * four varieties sit side by side on desktop rather than wrapping raggedly.
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
  return (
    <section className="rw-container rw-section" id="what-we-grow">
      <div className="rw-rule rw-section__rule" />

      <div className="rw-cards">
        <div className="rw-cards__lead rw-cards__lead--full">
          <h2 className="rw-display-2">{site.varieties.heading}</h2>
          <p className="rw-lede">{site.varieties.intro}</p>
          <dl className="rw-forms-legend">
            {Object.values(site.varieties.forms).map((form) => (
              <div className="rw-forms-legend__item" key={form.name}>
                <dt className="rw-forms-legend__name">{form.name}</dt>
                <dd className="rw-forms-legend__body">{form.body}</dd>
              </div>
            ))}
          </dl>
        </div>

        {site.varieties.items.map((variety) => (
          <PhotoCard className="rw-reveal" photo={variety.photo} key={variety.label}>
            <h3 className="rw-card__title">{variety.tradeName ?? variety.label}</h3>
            {variety.botanicalName !== null ? (
              <p className="rw-variety__botanical">{variety.botanicalName}</p>
            ) : null}
            <p className="rw-card__text">{variety.description}</p>
            <p className="rw-variety__forms">
              <span className="rw-visually-hidden">Cut as </span>
              {variety.forms.map((form) => (
                <span className="rw-variety__form" key={form}>
                  {site.varieties.forms[form].name}
                </span>
              ))}
            </p>
            <Specification spec={variety.spec} />
          </PhotoCard>
        ))}
      </div>
    </section>
  )
}
