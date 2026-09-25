// The two emails that hand a person their company address. They go to the
// person's OWN inbox, never to the new address: Cloudflare forwards nothing
// until that inbox has clicked its verification link, so an email to the new
// address would sit undelivered exactly when it is needed.
//
//   staffInviteEmail    a new account: set a password, confirm forwarding,
//                       set up Gmail
//   companyEmailNotice  an existing account moved onto its company address
import { button, detailsTable, escapeHtml, paragraphs, renderEmail } from './layout.js'

const text = (value) => paragraphs(escapeHtml(value))

/** The website page that walks through Gmail's "Send mail as". */
export function gmailGuideUrl(siteUrl) {
  return `${String(siteUrl ?? '').replace(/\/+$/, '')}/company-email/`
}

function forwardingStep(address) {
  return text(
    `Cloudflare, which carries the company's mail, will send this inbox a separate email asking you to verify it. Open it and click the link. Until you do, mail sent to ${address} cannot reach you.`,
  )
}

function frame(content, vars) {
  return {
    subject: content.subject,
    html: renderEmail({
      preheader: content.preheader,
      heading: content.heading,
      bodyHtml: content.bodyHtml,
      company: { company_name: 'Rasko Sweet Scent' },
      assetBaseUrl: vars.siteUrl,
      withSignature: false,
      ...(vars.logoSrc ? { logoSrc: vars.logoSrc } : {}),
    }),
    text: `${content.plain}\n\nRasko Sweet Scent\nAll that nature gives.`,
  }
}

/**
 * @param {{ fullName: string, address: string, personalEmail: string,
 *           link: string, siteUrl: string, logoSrc?: string }} vars
 */
export function staffInviteEmail(vars) {
  const guide = gmailGuideUrl(vars.siteUrl)
  return frame(
    {
      subject: 'Your Rasko Sweet Scent account and company email',
      preheader: `Your company address is ${vars.address}.`,
      heading: 'Welcome to Rasko Sweet Scent',
      bodyHtml:
        text(
          `${vars.fullName}, you have been given an account on the RSS Management System, where the team keeps clients, orders, invoices, stock and payroll, and a company email address.`,
        ) +
        detailsTable([
          ['Company email', vars.address],
          ['Delivered to', vars.personalEmail],
        ]) +
        text('1. Choose your password. You will sign in to the system with your company email.') +
        button('Choose your password', vars.link) +
        text(
          'The link works once and expires after one hour. If it has expired, ask the owner to send the invitation again.',
        ) +
        text('2. Confirm delivery to this inbox.') +
        forwardingStep(vars.address) +
        text(
          '3. Send from your company email in Gmail. It takes about five minutes, on a computer, once.',
        ) +
        button('Set up Gmail', guide) +
        text('If you were not expecting this email, you can ignore it.'),
      plain: [
        `${vars.fullName}, you have been given an account on the RSS Management System and a company email address: ${vars.address} (delivered to ${vars.personalEmail}).`,
        `1. Choose your password (the link works once, for one hour): ${vars.link}`,
        `2. Cloudflare will send this inbox an email asking you to verify it. Click its link, or mail to ${vars.address} cannot reach you.`,
        `3. Send from your company email in Gmail: ${guide}`,
      ].join('\n\n'),
    },
    vars,
  )
}

/**
 * @param {{ fullName: string, address: string, personalEmail: string,
 *           siteUrl: string, logoSrc?: string }} vars
 */
export function companyEmailNotice(vars) {
  const guide = gmailGuideUrl(vars.siteUrl)
  return frame(
    {
      subject: 'Your Rasko Sweet Scent company email address',
      preheader: `You now sign in with ${vars.address}.`,
      heading: 'Your company email address',
      bodyHtml:
        text(
          `${vars.fullName}, your RSS Management System account now has a company email address. Use it to sign in from now on. Your password has not changed.`,
        ) +
        detailsTable([
          ['Company email', vars.address],
          ['Delivered to', vars.personalEmail],
        ]) +
        forwardingStep(vars.address) +
        text('To send from it in Gmail, follow the short guide:') +
        button('Set up Gmail', guide) +
        text(
          'If you did not expect this change, tell the owner straight away so they can check the account.',
        ),
      plain: [
        `${vars.fullName}, your RSS Management System account now signs in with ${vars.address} (delivered to ${vars.personalEmail}). Your password has not changed.`,
        `Cloudflare will send this inbox an email asking you to verify it. Click its link, or mail to ${vars.address} cannot reach you.`,
        `Send from it in Gmail: ${guide}`,
      ].join('\n\n'),
    },
    vars,
  )
}
