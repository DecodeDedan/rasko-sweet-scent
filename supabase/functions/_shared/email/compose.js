// Turns a template row plus the facts of one record into a finished message.
// Pure: no database, no network, so it is tested directly
// (compose.test.mjs, `node --test`). send-email gathers the facts; this
// decides the words and the markup.
import { fillPlaceholders, fillPlain, paragraphs, renderEmail } from './layout.js'

/**
 * @param {{ subject: string, heading: string, body: string }} template
 * @param {{
 *   vars: Record<string, string|number|null|undefined>,
 *   blocksHtml?: string,
 *   personalNote?: string|null,
 *   company: import('./layout.js').Company,
 *   senderName?: string|null,
 *   assetBaseUrl: string,
 *   logoSrc?: string,
 * }} facts
 * @returns {{ subject: string, html: string, text: string }}
 */
export function composeEmail(template, facts) {
  const subject = fillPlain(template.subject, facts.vars)
    .replace(/[\r\n]+/g, ' ')
    .trim()
  const heading = fillPlain(template.heading, facts.vars)
  const note = facts.personalNote?.trim() ?? ''

  const bodyHtml =
    paragraphs(fillPlaceholders(template.body, facts.vars)) +
    (note ? paragraphs(fillPlaceholders(note, {})) : '') +
    (facts.blocksHtml ?? '')

  const html = renderEmail({
    preheader: firstLine(fillPlain(template.body, facts.vars), heading),
    heading,
    bodyHtml,
    company: facts.company,
    assetBaseUrl: facts.assetBaseUrl,
    senderName: facts.senderName,
    ...(facts.logoSrc ? { logoSrc: facts.logoSrc } : {}),
  })

  const companyName = facts.company.company_name || 'Rasko Sweet Scent'
  const text = [
    heading,
    '',
    fillPlain(template.body, facts.vars),
    note ? `\n${note}` : '',
    '',
    'Kind regards,',
    facts.senderName ?? '',
    companyName,
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n')
    .trim()

  return { subject, html, text }
}

/** The inbox preview line: the first sentence after the greeting. */
function firstLine(body, fallback) {
  const lines = String(body)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^dear\b/i.test(line))
  return (lines[0] ?? fallback).slice(0, 140)
}
