#!/usr/bin/env node
// Writes the Supabase Auth email templates (supabase/templates/*.html) from the
// same brand frame the client emails use (supabase/functions/_shared/email/
// layout.js), so staff and clients receive visibly the same company.
//
//   pnpm emails:auth
//
// Supabase fills its own Go-template placeholders ({{ .SiteURL }}, {{ .TokenHash }},
// {{ .RedirectTo }}, {{ .Email }}) when it sends. They pass through untouched:
// escaping leaves braces and dots alone, button hrefs are written raw, and the
// logo resolves against {{ .SiteURL }}, the marketing site that serves
// /email/rss-logo.png in every environment. The hosted project needs the same
// files pasted into Dashboard > Authentication > Email Templates
// (docs/auth-setup.md §2).
//
// Links carry token_hash, never ?code=: the app uses PKCE, and a PKCE code can
// only be redeemed by the app, not by the browser the email opens in.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  button,
  escapeHtml,
  paragraphs,
  renderEmail,
} from '../supabase/functions/_shared/email/layout.js'

const out = (name) => fileURLToPath(new URL(`../supabase/templates/${name}`, import.meta.url))

// Supabase Auth does not know the company's contact details, so the auth
// footer carries the name and slogan only, never a stale copy of settings.
const company = { company_name: 'Rasko Sweet Scent' }
const assetBaseUrl = '{{ .SiteURL }}'
const text = (value) => paragraphs(escapeHtml(value))

const TEMPLATES = {
  'invite.html': {
    preheader: 'Choose a password to start using the Rasko Sweet Scent business app.',
    heading: 'Welcome to Rasko Sweet Scent',
    bodyHtml:
      text(
        'You have been given an account on the Rasko Sweet Scent business app, where the team keeps clients, orders, invoices, stock and payroll.',
      ) +
      text('Choose your password to finish setting it up. You will sign in with {{ .Email }}.') +
      button('Choose your password', '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite') +
      text(
        'The link works once and expires after one hour. If it has expired, ask the owner to send the invitation again.\n\nIf you were not expecting this email, you can ignore it.',
      ),
  },
  'recovery.html': {
    preheader: 'A link to set a new password for your Rasko Sweet Scent account.',
    heading: 'Reset your password',
    bodyHtml:
      text('We received a request to reset the password for {{ .Email }}.') +
      button('Set a new password', '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery') +
      text(
        "The link works once and expires after one hour. To get a new one, choose Forgot your password on the app's sign-in screen.\n\nIf you did not ask for this, ignore this email. Your password has not changed.",
      ),
  },
  'password-changed.html': {
    preheader: 'The password on your Rasko Sweet Scent account was changed.',
    heading: 'Your password was changed',
    bodyHtml: text(
      'The password for {{ .Email }} on the Rasko Sweet Scent business app has just been changed.\n\nIf that was you, there is nothing to do.\n\nIf it was not, tell the owner straight away so they can deactivate the account, then use Forgot your password on the sign-in screen to take it back.',
    ),
  },
}

for (const [file, template] of Object.entries(TEMPLATES)) {
  writeFileSync(
    out(file),
    renderEmail({ ...template, company, assetBaseUrl, withSignature: false }),
  )
  process.stdout.write(`wrote supabase/templates/${file}\n`)
}
