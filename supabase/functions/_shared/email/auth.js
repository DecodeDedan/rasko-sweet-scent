// The wording of every Supabase Auth email, in one place. Two callers:
//
//   send-auth-email   Supabase's Send Email Hook: fills in the real address,
//                     link and site, then sends through the failover
//                     transport. This is what actually goes out.
//   build-auth-emails the same content with Supabase's Go placeholders, pasted
//                     into the dashboard as a fallback should the hook ever be
//                     switched off. Generated, so it cannot drift from this.
//
// Links carry token_hash, never ?code=: the app uses PKCE, and a PKCE code can
// only be redeemed by the app, not by the browser the email opens in.
import { button, escapeHtml, paragraphs, renderEmail } from './layout.js'

/** Supabase Auth email_action_type values this business sends. */
export const AUTH_EMAIL_TYPES = ['invite', 'recovery', 'password_changed_notification']

const text = (value) => paragraphs(escapeHtml(value))

/**
 * @param {string} type  email_action_type from the hook
 * @param {{ email: string, link: string, code?: string | null }} vars
 *   raw values (the hook) or Go placeholders (the template build)
 */
function content(type, vars) {
  switch (type) {
    case 'invite':
      return {
        subject: 'Your Rasko Sweet Scent account',
        preheader: 'Choose a password to start using the RSS Management System.',
        heading: 'Welcome to Rasko Sweet Scent',
        bodyHtml:
          text(
            'You have been given an account on the RSS Management System, where the team keeps clients, orders, invoices, stock and payroll.',
          ) +
          text(
            `Choose your password to finish setting it up. You will sign in with ${vars.email}.`,
          ) +
          button('Choose your password', vars.link) +
          text(
            'The link works once and expires after one hour. If it has expired, ask the owner to send the invitation again.\n\nIf you were not expecting this email, you can ignore it.',
          ),
        plain: `You have been given an account on the RSS Management System.\n\nChoose your password: ${vars.link}\n\nYou will sign in with ${vars.email}. The link works once and expires after one hour.`,
      }
    case 'recovery':
      return {
        subject: 'Reset your Rasko Sweet Scent password',
        preheader: 'A link to set a new password for your Rasko Sweet Scent account.',
        heading: 'Reset your password',
        bodyHtml:
          text(`We received a request to reset the password for ${vars.email}.`) +
          button('Set a new password', vars.link) +
          text(
            "The link works once and expires after one hour. To get a new one, choose Forgot your password on the app's sign-in screen.\n\nIf you did not ask for this, ignore this email. Your password has not changed.",
          ),
        plain: `We received a request to reset the password for ${vars.email}.\n\nSet a new password: ${vars.link}\n\nThe link works once and expires after one hour. If you did not ask for this, ignore this email.`,
      }
    case 'password_changed_notification':
      return {
        subject: 'Your Rasko Sweet Scent password was changed',
        preheader: 'The password on your Rasko Sweet Scent account was changed.',
        heading: 'Your password was changed',
        bodyHtml: text(
          `The password for ${vars.email} on the RSS Management System has just been changed.\n\nIf that was you, there is nothing to do.\n\nIf it was not, tell the owner straight away so they can deactivate the account, then use Forgot your password on the sign-in screen to take it back.`,
        ),
        plain: `The password for ${vars.email} on the RSS Management System has just been changed. If that was not you, tell the owner straight away.`,
      }
    default:
      // Signup, magic links and email change are switched off for this
      // project, so this should never be reached; if a future setting turns
      // one on, the person still gets a working, branded code.
      return {
        subject: 'Your Rasko Sweet Scent verification code',
        preheader: 'A verification code for your Rasko Sweet Scent account.',
        heading: 'Your verification code',
        bodyHtml: vars.code
          ? text(`Your code is ${vars.code}. It expires after one hour.`)
          : text('Open the Rasko Sweet Scent app to continue.'),
        plain: vars.code
          ? `Your code is ${vars.code}.`
          : 'Open the Rasko Sweet Scent app to continue.',
      }
  }
}

/**
 * @param {string} type
 * @param {{ email: string, link: string, code?: string | null, assetBaseUrl: string, logoSrc?: string }} vars
 * @returns {{ subject: string, html: string, text: string }}
 */
export function authEmail(type, vars) {
  const email = content(type, vars)
  return {
    subject: email.subject,
    html: renderEmail({
      preheader: email.preheader,
      heading: email.heading,
      bodyHtml: email.bodyHtml,
      // Auth does not know the company's contact details, so the footer
      // carries the name and slogan only, never a stale copy of settings.
      company: { company_name: 'Rasko Sweet Scent' },
      assetBaseUrl: vars.assetBaseUrl,
      withSignature: false,
      ...(vars.logoSrc ? { logoSrc: vars.logoSrc } : {}),
    }),
    text: `${email.plain}\n\nRasko Sweet Scent\nAll that nature gives.`,
  }
}

/**
 * The link an auth email opens: the website's /reset-password page with the
 * token hash. Auth has already checked `redirectTo` against the allowed list
 * before it calls the hook.
 * @param {{ redirectTo?: string | null, siteUrl?: string | null, tokenHash: string, type: string }} input
 */
export function authLink(input) {
  const fallback = `${String(input.siteUrl ?? '').replace(/\/+$/, '')}/reset-password`
  const url = new URL((input.redirectTo || fallback).split('#')[0])
  url.searchParams.set('token_hash', input.tokenHash)
  url.searchParams.set('type', input.type === 'invite' ? 'invite' : 'recovery')
  return url.toString()
}
