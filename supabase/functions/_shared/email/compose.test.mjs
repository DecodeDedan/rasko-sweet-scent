// node --test supabase/functions/_shared/email/compose.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { composeEmail } from './compose.js'
import { formatDate, formatKes, paymentBox } from './layout.js'

const template = {
  subject: 'Invoice {{invoice_number}} from {{company_name}}',
  heading: 'Invoice {{invoice_number}}',
  body: 'Dear {{client_name}},\n\nThe amount due is {{balance}}.',
}
const facts = {
  vars: {
    invoice_number: 'INV-2026-0007',
    company_name: 'Rasko Sweet Scent',
    client_name: 'Menengai & Sons',
    balance: 'KES 1,200.00',
  },
  company: { company_name: 'Rasko Sweet Scent' },
  senderName: 'Dedan Okware',
  assetBaseUrl: 'https://example.test/',
}

test('fills placeholders in subject, heading and body', () => {
  const email = composeEmail(template, facts)
  assert.equal(email.subject, 'Invoice INV-2026-0007 from Rasko Sweet Scent')
  assert.match(email.html, /Invoice INV-2026-0007<\/h1>/)
  assert.match(email.html, /The amount due is KES 1,200.00/)
})

test('escapes client-supplied values once, never twice', () => {
  const email = composeEmail(template, facts)
  assert.match(email.html, /Menengai &amp; Sons/)
  assert.doesNotMatch(email.html, /&amp;amp;/)
  assert.match(email.text, /Menengai & Sons/)
})

test('treats markup typed into a template or note as text', () => {
  const email = composeEmail(
    { ...template, body: 'Hi <b>{{client_name}}</b>' },
    { ...facts, personalNote: '<script>alert(1)</script>' },
  )
  assert.doesNotMatch(email.html, /<script>|<b>/)
  assert.match(email.html, /&lt;script&gt;/)
})

test('leaves an unknown placeholder visible so a typo shows in review', () => {
  const email = composeEmail({ ...template, body: 'Due {{due_dat}}' }, facts)
  assert.match(email.html, /\{\{due_dat\}\}/)
})

test('keeps a subject on one line, whatever the values contain', () => {
  const email = composeEmail(template, {
    ...facts,
    vars: { ...facts.vars, invoice_number: 'A\r\nBcc: x@y' },
  })
  assert.doesNotMatch(email.subject, /[\r\n]/)
})

test('signs with the sender and carries the logo from the asset base', () => {
  const email = composeEmail(template, facts)
  assert.match(email.html, /Kind regards,<br>Dedan Okware/)
  assert.match(email.html, /src="https:\/\/example.test\/email\/rss-logo.png"/)
})

test('omits the payment box while no payment detail is set', () => {
  assert.equal(paymentBox({}), '')
  assert.match(paymentBox({ mpesa_paybill: '123456' }), /M-Pesa Paybill/)
})

test('formats money and dates the PRD way', () => {
  assert.equal(formatKes(1250000), 'KES 12,500.00')
  assert.equal(formatDate('2026-09-25'), '25/09/2026')
})

test('points the logo at the attached image when sending, not at a hosted URL', () => {
  const email = composeEmail(template, { ...facts, logoSrc: 'cid:rss-logo@raskosweetscent' })
  assert.match(email.html, /src="cid:rss-logo@raskosweetscent"/)
  assert.doesNotMatch(email.html, /example\.test\/email\/rss-logo\.png/)
})
