// The Rasko Sweet Scent email frame: logo header, green rule, body, sign-off,
// company footer. Every email the business sends passes through renderEmail,
// the client emails from the send-email function and the Supabase Auth
// templates built by scripts/build-auth-emails.mjs, so they cannot drift apart.
//
// Plain JavaScript on purpose: Deno (the edge function) and Node (the build
// script) both import it without a compile step.
//
// Email HTML is its own discipline. Layout is tables, styles are inline, and
// widths are fixed at 600px, because Outlook renders with Word's engine and
// Gmail strips <style> blocks it does not like. The bundled Lora and Manrope
// cannot be relied on in a mail client, so the stacks fall back to Georgia and
// Arial, which every client has and which keep the serif/sans pairing.
//
// Palette: docs/brand.md only. Rasko Green on the header rule, the totals row
// and the one button; ink on white everywhere else (the document rule).

/** @typedef {{ company_name?: string|null, address?: string|null, phone?: string|null, email?: string|null, kra_pin?: string|null, mpesa_paybill?: string|null, mpesa_till?: string|null, bank_details?: Record<string, string>|null }} Company */

const GREEN = '#2D6A2F'
const TINT = '#E9F2E7'
const TINT_BORDER = '#CFE3CC'
const INK = '#111111'
const INK_SECONDARY = '#5C5F58'
const BORDER = '#E4E4E0'
const SUBTLE = '#F7F7F5'
const SERIF = "Lora, Georgia, 'Times New Roman', serif"
const SANS = "Manrope, Arial, 'Helvetica Neue', Helvetica, sans-serif"

export const SLOGAN = 'All that nature gives.'

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Fills {{name}} placeholders. Values are escaped here, so a client called
 * "<script>" arrives as text. An unknown placeholder is left visible rather
 * than blanked, so a typo in Settings shows in the preview instead of silently
 * dropping words from a customer email.
 * @param {string} text
 * @param {Record<string, string|number|null|undefined>} vars
 */
export function fillPlaceholders(text, vars) {
  return escapeHtml(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null
      ? escapeHtml(vars[name])
      : match,
  )
}

/**
 * The same fill without escaping, for the subject line (a mail header, not
 * HTML) and the heading (which renderEmail escapes itself). Escaping twice
 * would show "&amp;" to the client.
 * @param {string} text
 * @param {Record<string, string|number|null|undefined>} vars
 */
export function fillPlain(text, vars) {
  return String(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null
      ? String(vars[name])
      : match,
  )
}

/**
 * Plain text to paragraphs: a blank line starts a paragraph, a single newline
 * is a line break. Input must already be escaped (fillPlaceholders does it).
 * @param {string} escapedText
 */
export function paragraphs(escapedText) {
  return String(escapedText)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK};">${block.replace(/\n/g, '<br>')}</p>`,
    )
    .join('')
}

/** KES 12,500.00 (PRD §7). Mirrors formatKes in packages/ui for a runtime that cannot import it. */
export function formatKes(cents) {
  const amount = Number(cents ?? 0) / 100
  return `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** DD/MM/YYYY in Africa/Nairobi (PRD §7). */
export function formatDate(value) {
  if (!value) return ''
  const date =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00+03:00`)
      : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/**
 * A bulletproof button: a table cell, so Outlook draws it too. `href` is
 * written raw so a Supabase Auth placeholder such as {{ .ConfirmationURL }}
 * survives; callers pass only URLs they built.
 */
export function button(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr><td style="background:${GREEN};border-radius:8px;">
    <a href="${href}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`
}

/** Label / value rows, e.g. invoice number, due date. @param {Array<[string, string]>} rows */
export function detailsTable(rows) {
  const body = rows
    .filter(([, value]) => value)
    .map(
      ([label, value]) => `<tr>
    <td style="padding:6px 0;font-family:${SANS};font-size:13px;color:${INK_SECONDARY};width:40%;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-family:${SANS};font-size:14px;color:${INK};font-weight:600;">${escapeHtml(value)}</td>
  </tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">${body}</table>`
}

/**
 * Line items with a green totals row, the same emphasis as the printed
 * invoice. @param {Array<{ description: string, quantity: string, amount: string }>} lines
 * @param {Array<[string, string]>} totals the last row is the emphasised one
 */
export function itemsTable(lines, totals) {
  const head = ['Item', 'Qty', 'Amount']
    .map(
      (label, i) =>
        `<th style="padding:8px 0;font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${INK_SECONDARY};text-align:${i === 0 ? 'left' : 'right'};border-bottom:1px solid ${BORDER};">${label}</th>`,
    )
    .join('')
  const body = lines
    .map(
      (line) => `<tr>
    <td style="padding:10px 0;font-family:${SANS};font-size:14px;color:${INK};border-bottom:1px solid ${BORDER};">${escapeHtml(line.description)}</td>
    <td style="padding:10px 0 10px 12px;font-family:${SANS};font-size:14px;color:${INK};text-align:right;white-space:nowrap;border-bottom:1px solid ${BORDER};">${escapeHtml(line.quantity)}</td>
    <td style="padding:10px 0 10px 12px;font-family:${SANS};font-size:14px;color:${INK};text-align:right;white-space:nowrap;border-bottom:1px solid ${BORDER};">${escapeHtml(line.amount)}</td>
  </tr>`,
    )
    .join('')
  const foot = totals
    .map(([label, value], i) => {
      const isLast = i === totals.length - 1
      const style = isLast
        ? `background:${GREEN};color:#FFFFFF;font-weight:700;`
        : `color:${INK_SECONDARY};`
      return `<tr>
    <td colspan="2" style="padding:${isLast ? '10px 12px' : '6px 0'};font-family:${SANS};font-size:14px;${style}text-align:right;">${escapeHtml(label)}</td>
    <td style="padding:${isLast ? '10px 12px' : '6px 0 6px 12px'};font-family:${SANS};font-size:14px;${style}text-align:right;white-space:nowrap;">${escapeHtml(value)}</td>
  </tr>`
    })
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`
}

/**
 * How to pay, from company settings. Omitted entirely while no payment detail
 * is set (PRD §12 q6), rather than printing an empty box or an invented number.
 * @param {Company} company
 */
export function paymentBox(company) {
  const rows = []
  if (company.mpesa_paybill) rows.push(['M-Pesa Paybill', company.mpesa_paybill])
  if (company.mpesa_till) rows.push(['M-Pesa Till', company.mpesa_till])
  for (const [label, value] of Object.entries(company.bank_details ?? {})) {
    if (value)
      rows.push([label.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), String(value)])
  }
  if (rows.length === 0) return ''
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:3px 0;font-family:${SANS};font-size:13px;color:${INK_SECONDARY};width:40%;">${escapeHtml(label)}</td><td style="padding:3px 0;font-family:${SANS};font-size:14px;color:${INK};font-weight:600;">${escapeHtml(value)}</td></tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;background:${TINT};border:1px solid ${TINT_BORDER};border-radius:8px;">
  <tr><td style="padding:16px 18px;">
    <p style="margin:0 0 8px;font-family:${SERIF};font-size:16px;font-weight:600;color:${INK};">How to pay</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
  </td></tr>
</table>`
}

/** @param {{ name?: string|null, companyName: string }} sender */
function signature(sender) {
  const name = sender.name ? `${escapeHtml(sender.name)}<br>` : ''
  return `<p style="margin:24px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK};">Kind regards,<br>${name}<span style="font-family:${SERIF};font-weight:600;">${escapeHtml(sender.companyName)}</span></p>`
}

/** @param {Company} company */
function footer(company) {
  const contact = [company.address, company.phone, company.email].filter(Boolean).map(escapeHtml)
  const kra = company.kra_pin ? `KRA PIN ${escapeHtml(company.kra_pin)}` : ''
  return `<tr><td style="padding:24px 40px 28px;background:${SUBTLE};border-top:1px solid ${BORDER};border-radius:0 0 8px 8px;">
    <p style="margin:0 0 6px;font-family:${SERIF};font-size:15px;font-style:italic;color:${GREEN};">${SLOGAN}</p>
    <p style="margin:0 0 4px;font-family:${SANS};font-size:12px;line-height:1.6;color:${INK_SECONDARY};">${escapeHtml(company.company_name || 'Rasko Sweet Scent')}${contact.length ? ` &middot; ${contact.join(' &middot; ')}` : ''}</p>
    ${kra ? `<p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${INK_SECONDARY};">${kra}</p>` : ''}
  </td></tr>`
}

/**
 * The whole email.
 * @param {{
 *   preheader: string,
 *   heading: string,
 *   bodyHtml: string,
 *   company: Company,
 *   assetBaseUrl: string,
 *   senderName?: string|null,
 *   withSignature?: boolean,
 *   logoSrc?: string,
 * }} input  heading is plain text (escaped here); bodyHtml is trusted markup.
 *   logoSrc overrides the hosted logo: the functions pass the cid of the logo
 *   they attach (logo.js), the app's preview passes a data URI.
 */
export function renderEmail(input) {
  const company = input.company ?? {}
  const companyName = company.company_name || 'Rasko Sweet Scent'
  const logo =
    input.logoSrc ?? `${String(input.assetBaseUrl).replace(/\/+$/, '')}/email/rss-logo.png`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${SUBTLE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${SUBTLE};">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SUBTLE};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${BORDER};border-radius:8px;">
    <tr><td style="padding:28px 40px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:14px;"><img src="${logo}" width="41" height="48" alt="RSS" style="display:block;border:0;width:41px;height:48px;"></td>
        <td style="vertical-align:middle;">
          <p style="margin:0;font-family:${SERIF};font-size:19px;font-weight:600;color:${INK};">${escapeHtml(companyName)}</p>
          <p style="margin:2px 0 0;font-family:${SANS};font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${INK_SECONDARY};">Highland eucalyptus, grown for the trade</p>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:0 40px;"><div style="height:3px;line-height:3px;font-size:0;background:${GREEN};">&nbsp;</div></td></tr>
    <tr><td style="padding:32px 40px 8px;">
      <h1 style="margin:0 0 20px;font-family:${SERIF};font-size:24px;line-height:1.3;font-weight:600;color:${INK};">${escapeHtml(input.heading)}</h1>
      ${input.bodyHtml}
      ${input.withSignature === false ? '' : signature({ name: input.senderName, companyName })}
    </td></tr>
    <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
    ${footer(company)}
  </table>
</td></tr>
</table>
</body>
</html>`
}
