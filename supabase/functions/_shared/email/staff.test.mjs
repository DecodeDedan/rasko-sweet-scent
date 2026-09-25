// node --test supabase/functions/_shared/email/staff.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { companyEmailNotice, gmailGuideUrl, staffInviteEmail } from './staff.js'

const vars = {
  fullName: 'Jane <b>Kamau</b>',
  address: 'jane.kamau@raskosweetscent.com',
  personalEmail: 'jane@gmail.com',
  link: 'https://www.raskosweetscent.com/reset-password/?token_hash=abc&type=invite',
  siteUrl: 'https://www.raskosweetscent.com/',
}

test('the invitation carries the address, the password link and the Gmail guide', () => {
  const email = staffInviteEmail(vars)
  assert.match(email.html, /jane\.kamau@raskosweetscent\.com/)
  assert.ok(email.html.includes(vars.link))
  assert.ok(email.html.includes('https://www.raskosweetscent.com/company-email/'))
  assert.match(email.text, /verify/)
  assert.ok(email.text.includes(vars.link))
})

test('a name cannot inject markup into either email', () => {
  for (const email of [staffInviteEmail(vars), companyEmailNotice(vars)]) {
    assert.ok(!email.html.includes('<b>Kamau</b>'))
    assert.ok(email.html.includes('Jane &lt;b&gt;Kamau&lt;/b&gt;'))
  }
})

test('the notice says the password is unchanged and has no password link', () => {
  const email = companyEmailNotice(vars)
  assert.match(email.text, /password has not changed/)
  assert.ok(!email.html.includes('token_hash'))
})

test('the guide address never doubles its slash', () => {
  assert.equal(gmailGuideUrl('https://x.com///'), 'https://x.com/company-email/')
})
