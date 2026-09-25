import type { Metadata } from 'next'

/**
 * Staff-only: the page the invitation and company-email emails link to
 * (supabase/functions/_shared/email/staff.js). It sets up Gmail's "Send mail
 * as" for a company address that Cloudflare Email Routing forwards to the
 * person's own Gmail (docs/company-email.md). Receiving needs nothing from
 * them beyond Cloudflare's verification link; sending needs this, once.
 *
 * Not indexed and not in the sitemap: it is instructions for the team, not
 * something a buyer should land on from a search.
 */
export const metadata: Metadata = {
  title: 'Set up your company email in Gmail',
  robots: { index: false, follow: false },
}

export default function CompanyEmailPage() {
  return (
    <section className="rw-container rw-section" style={{ paddingTop: '9rem' }}>
      <div className="rw-prose">
        <h1 className="rw-display-2">Your company email in Gmail</h1>
        <p>
          Mail sent to your company address already arrives in your own Gmail once you have clicked
          the verification link Cloudflare emailed you. These steps let you send from the company
          address too, so clients see it on every reply. Do them once, on a computer. It takes about
          five minutes.
        </p>

        <h2>1. Make a password for Gmail to use</h2>
        <ol>
          <li>
            Open <a href="https://myaccount.google.com/security">myaccount.google.com/security</a>{' '}
            and turn on <strong>2-Step Verification</strong> if it is off. Google requires it for
            the next step.
          </li>
          <li>
            Open{' '}
            <a href="https://myaccount.google.com/apppasswords">
              myaccount.google.com/apppasswords
            </a>
            , type <strong>Rasko company email</strong> as the name and choose{' '}
            <strong>Create</strong>.
          </li>
          <li>
            Google shows a 16-letter password once. Keep that window open; you need it in step 2. It
            is not your Gmail password, and you never type it anywhere else.
          </li>
        </ol>

        <h2>2. Add the company address to Gmail</h2>
        <ol>
          <li>
            Open <a href="https://mail.google.com">Gmail</a>, choose the gear icon, then{' '}
            <strong>See all settings</strong> and the <strong>Accounts and Import</strong> tab.
          </li>
          <li>
            Next to <strong>Send mail as</strong>, choose <strong>Add another email address</strong>
            .
          </li>
          <li>
            Enter your name and your company address from the invitation email. Leave{' '}
            <strong>Treat as an alias</strong> ticked and choose <strong>Next Step</strong>.
          </li>
          <li>
            Fill in: SMTP Server <strong>smtp.gmail.com</strong>, Port <strong>587</strong>,
            Username <strong>your full Gmail address</strong>, Password{' '}
            <strong>the 16-letter password from step 1</strong>. Keep{' '}
            <strong>Secured connection using TLS</strong> selected and choose{' '}
            <strong>Add Account</strong>.
          </li>
          <li>
            Gmail sends a confirmation email to your company address. It arrives in this same inbox
            within a minute. Open it and click the link.
          </li>
          <li>
            Back on <strong>Accounts and Import</strong>, under{' '}
            <strong>When replying to a message</strong>, choose{' '}
            <strong>Reply from the same address the message was sent to</strong>. Replies to company
            mail then go out from the company address without you choosing it.
          </li>
        </ol>

        <h2>Using it</h2>
        <p>
          When you write a new email, choose your company address in the <strong>From</strong> line.
          The Gmail app on your phone offers the same choice once the steps above are done on a
          computer.
        </p>

        <h2>If something does not work</h2>
        <ul>
          <li>
            <strong>The app passwords page says the setting is not available.</strong> 2-Step
            Verification is still off. Turn it on, then open the page again.
          </li>
          <li>
            <strong>Gmail&apos;s confirmation email never arrives.</strong> Mail to your company
            address only reaches you after you click Cloudflare&apos;s verification link. Search
            your inbox and spam for it, click it, then choose <strong>Resend email</strong> in
            Gmail.
          </li>
          <li>
            <strong>Gmail says it cannot reach the server.</strong> Check the password is the
            16-letter one from step 1, not your Gmail password, and that the port is 587.
          </li>
        </ul>
        <p>Anything else, ask the owner, who can see your account in the RSS Management System.</p>
      </div>
    </section>
  )
}
