import { PhotoCard } from './PhotoCard'
import { site } from '../content/site'

/**
 * The one recessed band on the page, and the place a buyer assessing capacity
 * looks for numbers.
 *
 * Those numbers are not confirmed yet, so the figures block renders nothing
 * and the section stands on its two paragraphs and its two photograph cards, one of
 * the field and one of the shed. That is the intended behaviour rather than a
 * degraded state: the prose says what the photographs show, and neither claims
 * a quantity nobody has verified. When content/site.ts gains a weekly output,
 * the figure appears here at display size in tabular numerals, and it becomes
 * the second loudest thing on the page after the hero.
 */

const FIGURE_ORDER = ['weeklyOutput', 'plantedArea', 'cuttingDays'] as const

export function Farm() {
  const figures = FIGURE_ORDER.map((key) => site.farm.figures[key]).filter(
    (figure): figure is { value: string; unit: string } => figure !== null,
  )

  return (
    <section className="rw-section rw-section--sunk" id="the-farm">
      <div className="rw-container">
        <div className="rw-cards">
          <div className="rw-cards__lead">
            <h2 className="rw-display-2">{site.farm.heading}</h2>

            <div style={{ marginTop: 'var(--rasko-space-5)' }}>
              {site.farm.body.map((paragraph) => (
                <p className="rw-body" key={paragraph}>
                  {paragraph}
                </p>
              ))}
            </div>

            {figures.length > 0 ? (
              <dl className="rw-figures">
                {figures.map((figure) => (
                  <div key={figure.unit}>
                    <dd className="rw-figure-value">{figure.value}</dd>
                    <dt className="rw-figure__unit">{figure.unit}</dt>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          <PhotoCard className="rw-reveal" photo="field-silver-row">
            <h3 className="rw-card__title">In the field</h3>
          </PhotoCard>

          <PhotoCard className="rw-reveal" photo="shed-wide">
            <h3 className="rw-card__title">In the shed</h3>
          </PhotoCard>
        </div>
      </div>
    </section>
  )
}
