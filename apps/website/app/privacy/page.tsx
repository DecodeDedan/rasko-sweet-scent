import type { Metadata } from 'next'

import { site } from '../../content/site'

/**
 * Required by PRD section 9 (Kenyan Data Protection Act 2019).
 *
 * Everything below is true of this website as built, and was checked against
 * the code rather than adapted from a template. The site is a static export
 * with no analytics script, no cookie, no embedded third-party frame and no
 * form, so there is genuinely nothing to disclose about collection. Saying so
 * plainly is more useful to a reader, and more defensible, than a page of
 * boilerplate describing practices that do not happen here.
 *
 * If a contact form is ever added (PRD section 8 keeps a
 * website_contact_messages table for one), this page has to be revised in the
 * same change. It is not accurate by accident and it will not stay accurate on
 * its own.
 *
 * The company's wider obligations as a data controller, including whether it
 * is registered with the Office of the Data Protection Commissioner, are a
 * separate question that PRD section 9 still lists as unanswered. This page
 * deliberately makes no claim about them.
 */
export const metadata: Metadata = {
  title: 'Privacy',
  description: `How ${site.name} handles information on this website.`,
}

export default function PrivacyPage() {
  const { contact } = site
  const canBeReached = contact.email !== null || contact.phoneDisplay !== null

  return (
    <section className="rw-container rw-section" style={{ paddingTop: '9rem' }}>
      <div className="rw-prose">
        <h1 className="rw-display-2">Privacy</h1>

        <h2>What this website collects</h2>
        <p>
          Nothing. This site is a set of static pages. It runs no analytics, sets no cookies, embeds
          nothing from another company, and has no form to fill in. We do not know who visits it.
        </p>
        <p>
          Our hosting provider keeps ordinary server records, such as the address a request came
          from, for the short period needed to serve pages and defend against abuse. We do not read
          them to identify anyone.
        </p>

        <h2>When you message us</h2>
        <p>
          The buttons on this site open WhatsApp. Sending a message there is a decision you make in
          WhatsApp, and the message travels through WhatsApp rather than through this website. Their
          terms and privacy policy govern that.
        </p>
        <p>
          Once your enquiry reaches us we keep what we need to answer it and to supply your order:
          your name, how to contact you, and what you asked for. We use it for your order and
          nothing else. We do not sell it and we do not pass it to anyone who is not helping us
          deliver to you.
        </p>

        <h2>Your rights</h2>
        <p>
          Under the Data Protection Act 2019 you may ask us what we hold about you, ask us to
          correct it, and ask us to delete it. You may also object to us using it.
          {canBeReached ? ' Contact us using the details below and we will respond.' : null}
        </p>

        {canBeReached ? (
          <>
            <h2>Contact</h2>
            <p>
              {contact.email !== null ? (
                <a className="rw-link" href={`mailto:${contact.email}`}>
                  {contact.email}
                </a>
              ) : null}
              {contact.email !== null && contact.phoneDisplay !== null ? ', or ' : null}
              {contact.phoneDisplay !== null ? contact.phoneDisplay : null}
            </p>
          </>
        ) : null}

        <h2>Changes</h2>
        <p>If this site starts collecting anything, this page will say so before that happens.</p>
      </div>
    </section>
  )
}
