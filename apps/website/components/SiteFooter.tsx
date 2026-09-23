import logo from '../../../docs/brand/logo.svg'
import { site } from '../content/site'

/**
 * Contact details, and the privacy notice the PRD requires (section 9, Kenyan
 * Data Protection Act 2019).
 *
 * Every line here is conditional. A detail the client has not confirmed leaves
 * no trace: no empty heading, no dash standing in for a value.
 */
export function SiteFooter() {
  const { contact, location } = site
  const year = new Date().getFullYear()

  const hasContact =
    contact.phoneDisplay !== null || contact.email !== null || contact.hours !== null

  return (
    <footer className="rw-footer">
      <div className="rw-container">
        <div className="rw-footer__grid">
          <div>
            <h2>The farm</h2>
            <address>
              {site.name}
              <br />
              {location.area !== null ? (
                <>
                  {location.area}
                  <br />
                </>
              ) : null}
              {location.town}, {location.country}
            </address>
          </div>

          {hasContact ? (
            <div>
              <h2>Contact</h2>
              <address>
                {contact.phoneDisplay !== null ? (
                  <>
                    <a href={`tel:${contact.phoneDisplay.replace(/\s/g, '')}`}>
                      {contact.phoneDisplay}
                    </a>
                    <br />
                  </>
                ) : null}
                {contact.email !== null ? (
                  <>
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    <br />
                  </>
                ) : null}
                {contact.hours !== null ? contact.hours : null}
              </address>
            </div>
          ) : null}

          <div>
            <h2>What we supply</h2>
            <address>
              Fresh-cut eucalyptus foliage
              <br />
              to florists, decorators
              <br />
              and wholesalers
            </address>
          </div>
        </div>

        <div className="rw-footer__legal">
          <img className="rw-footer__mark" src={logo.src} width={logo.width} height={logo.height} alt="" />
          <span>
            {year} {site.name}
          </span>
          <a className="rw-link" href="/privacy/">
            Privacy
          </a>
        </div>
      </div>
    </footer>
  )
}
