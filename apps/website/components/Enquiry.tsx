import { site } from '../content/site'
import { whatsappLink } from '../lib/whatsapp'

/**
 * The close, and the only large field of green on the site.
 *
 * Kept entirely typographic. After five sections of photography a band with no
 * image in it is a change of register, and it puts nothing between the reader
 * and the one thing the page wants them to do.
 *
 * The checklist is the part that earns its place. A trade enquiry that arrives
 * saying "how much is eucalyptus" costs two more messages before anyone can
 * answer it, so the page says what a useful first message contains and the
 * WhatsApp composer opens with the greeting already written.
 */

const TERM_LABELS = {
  minimumOrder: 'Minimum order',
  leadTime: 'Lead time',
  delivery: 'Delivery',
  packing: 'Packing',
  payment: 'Payment',
} as const

export function Enquiry() {
  const { enquiry, contact } = site
  const link = whatsappLink(contact.whatsapp, enquiry.prefill)

  // flatMap narrows `value` to string by dropping the null cases, which a
  // filter predicate cannot express cleanly against the literal label types.
  const terms = (Object.keys(TERM_LABELS) as (keyof typeof TERM_LABELS)[]).flatMap((key) => {
    const value = enquiry.terms[key]
    return value === null ? [] : [{ key, label: TERM_LABELS[key], value }]
  })

  return (
    <section className="rw-section rw-enquiry" id="enquire">
      <div className="rw-container rw-enquiry__grid">
        <div>
          <h2 className="rw-display-2">{enquiry.heading}</h2>
          <p className="rw-enquiry__body">{enquiry.body}</p>

          <div className="rw-enquiry__actions">
            {/* No number yet: no button. A disabled control announcing a missing
                fact is a placeholder, and the site renders none. */}
            {link === null ? null : (
              <a
                className="rw-button rw-button--inverse"
                href={link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open WhatsApp
              </a>
            )}

            {contact.phoneDisplay !== null ? (
              <a
                className="rw-enquiry__phone rw-link"
                href={`tel:${contact.phoneDisplay.replace(/\s/g, '')}`}
              >
                {contact.phoneDisplay}
              </a>
            ) : null}
          </div>

          {terms.length > 0 ? (
            <dl className="rw-terms">
              {terms.map((term) => (
                <div className="rw-terms__row" key={term.key}>
                  <dt className="rw-terms__label">{term.label}</dt>
                  <dd className="rw-terms__value">{term.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>

        <div className="rw-reveal">
          <p className="rw-checklist__title">Please tell us</p>
          <ul className="rw-checklist">
            {enquiry.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
