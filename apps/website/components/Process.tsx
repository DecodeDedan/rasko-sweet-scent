import { PhotoCard } from './PhotoCard'
import { site } from '../content/site'

/**
 * Cut, sort, tie, hold.
 *
 * This is the only part of the page that carries numbers, and it carries them
 * because the content is genuinely a sequence: step three cannot happen before
 * step two. Numbering a set of unordered features is decoration pretending to
 * be structure, which is why it is absent everywhere else.
 *
 * Each step is a PhotoCard, the same size as every other photograph on the
 * page.
 */
export function Process() {
  return (
    <section className="rw-container rw-section">
      <div className="rw-rule rw-section__rule" />

      <div className="rw-section__head">
        <h2 className="rw-display-2">{site.process.heading}</h2>
      </div>

      <ol className="rw-cards rw-process">
        {site.process.steps.map((step, index) => (
          <li key={step.title}>
            <PhotoCard photo={step.photo}>
              <div className="rw-step__meta">
                <span className="rw-step__number">{index + 1}</span>
                <h3 className="rw-card__title">{step.title}</h3>
              </div>
              <p className="rw-card__text">{step.body}</p>
            </PhotoCard>
          </li>
        ))}
      </ol>
    </section>
  )
}
