// node --test supabase/functions/_shared/email/transport.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FAULT_COOLDOWN_MS,
  QUOTA_COOLDOWN_MS,
  configuredProviders,
  memoryHealth,
  sendWithFailover,
} from './transport.js'

const message = { to: 'buyer@example.test', subject: 'Test', html: '<p>x</p>', text: 'x' }
const providers = ['brevo', 'resend', 'gmail'].map((name) => ({
  name,
  from: `Rasko <${name}@example.test>`,
  transport: { name },
}))

/** Fake SMTP: each provider name maps to "ok" or an error to throw. */
function fakeSmtp(behaviour) {
  const calls = []
  return {
    calls,
    createTransport: (transport) => ({
      sendMail: async () => {
        calls.push(transport.name)
        const outcome = behaviour[transport.name]
        if (outcome === 'ok') return { messageId: `${transport.name}-1` }
        throw outcome
      },
    }),
  }
}

const quota = Object.assign(new Error('Daily sending quota exceeded'), { responseCode: 421 })
const down = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })

test('sends through the first provider when it works', async () => {
  const smtp = fakeSmtp({ brevo: 'ok', resend: 'ok', gmail: 'ok' })
  const result = await sendWithFailover(message, { providers, ...smtp, health: memoryHealth() })
  assert.equal(result.provider, 'brevo')
  assert.deepEqual(smtp.calls, ['brevo'])
})

test('fails over to the next provider in the same call when one is over quota', async () => {
  const smtp = fakeSmtp({ brevo: quota, resend: 'ok', gmail: 'ok' })
  const result = await sendWithFailover(message, { providers, ...smtp, health: memoryHealth() })
  assert.equal(result.provider, 'resend')
  assert.deepEqual(smtp.calls, ['brevo', 'resend'])
})

test('skips a provider it already knows is down, without trying it again', async () => {
  const health = memoryHealth()
  let clock = 1_000_000
  const now = () => clock
  await sendWithFailover(message, {
    providers,
    ...fakeSmtp({ brevo: quota, resend: 'ok', gmail: 'ok' }),
    health,
    now,
  })

  // The next email, a minute later: brevo is resting, so it is not touched.
  clock += 60_000
  const smtp = fakeSmtp({ brevo: quota, resend: 'ok', gmail: 'ok' })
  const result = await sendWithFailover(message, { providers, ...smtp, health, now })
  assert.equal(result.provider, 'resend')
  assert.deepEqual(smtp.calls, ['resend'])
  assert.deepEqual(result.skipped, ['brevo'])
})

test('rests a quota failure for an hour and anything else for two minutes', async () => {
  const health = memoryHealth()
  const now = () => 0
  await sendWithFailover(message, {
    providers,
    ...fakeSmtp({ brevo: quota, resend: down, gmail: 'ok' }),
    health,
    now,
  })
  assert.equal(await health.unhealthyUntil('brevo'), QUOTA_COOLDOWN_MS)
  assert.equal(await health.unhealthyUntil('resend'), FAULT_COOLDOWN_MS)
})

test('comes back to a rested provider once its cooldown ends', async () => {
  const health = memoryHealth()
  let clock = 0
  const now = () => clock
  await sendWithFailover(message, {
    providers,
    ...fakeSmtp({ brevo: down, resend: 'ok', gmail: 'ok' }),
    health,
    now,
  })
  clock = FAULT_COOLDOWN_MS + 1
  const smtp = fakeSmtp({ brevo: 'ok', resend: 'ok', gmail: 'ok' })
  const result = await sendWithFailover(message, { providers, ...smtp, health, now })
  assert.equal(result.provider, 'brevo')
})

test('does not burn through every provider when the address itself is refused', async () => {
  const noSuchUser = Object.assign(new Error('550 5.1.1 no such user'), { responseCode: 550 })
  const smtp = fakeSmtp({ brevo: noSuchUser, resend: 'ok', gmail: 'ok' })
  await assert.rejects(
    sendWithFailover(message, { providers, ...smtp, health: memoryHealth() }),
    /address was refused/,
  )
  assert.deepEqual(smtp.calls, ['brevo'])
})

test('still tries resting providers when every healthy one fails', async () => {
  const health = memoryHealth()
  await health.markUnhealthy('gmail', Number.MAX_SAFE_INTEGER, 'earlier')
  const smtp = fakeSmtp({ brevo: down, resend: down, gmail: 'ok' })
  const result = await sendWithFailover(message, { providers, ...smtp, health, now: () => 0 })
  assert.equal(result.provider, 'gmail')
})

test('reports every failure when nothing can send', async () => {
  const smtp = fakeSmtp({ brevo: down, resend: quota, gmail: down })
  await assert.rejects(
    sendWithFailover(message, { providers, ...smtp, health: memoryHealth() }),
    /brevo .*resend .*gmail/,
  )
})

test('uses only providers with credentials, in the configured order', () => {
  const env = {
    EMAIL_PROVIDERS: 'gmail,brevo,resend',
    EMAIL_FROM: 'Rasko <hello@example.test>',
    BREVO_SMTP_USER: 'u',
    BREVO_SMTP_KEY: 'k',
    GMAIL_USER: 'rasko@gmail.test',
    GMAIL_APP_PASSWORD: 'p',
  }
  const names = configuredProviders((key) => env[key]).map((p) => p.name)
  assert.deepEqual(names, ['gmail', 'brevo'])
})

test('falls back to the local Mailpit only when no real provider is configured', () => {
  const local = {
    EMAIL_FROM: 'Rasko <hello@example.test>',
    SMTP_HOST: 'inbucket',
    SMTP_PORT: '1025',
  }
  assert.deepEqual(
    configuredProviders((key) => local[key]).map((p) => p.name),
    ['mailpit'],
  )
  const withReal = { ...local, RESEND_API_KEY: 're_x' }
  assert.deepEqual(
    configuredProviders((key) => withReal[key]).map((p) => p.name),
    ['resend'],
  )
})

test('a provider that may not send to this address is passed over but not benched', async () => {
  // Resend's test sender (onboarding@resend.dev) only delivers to the account
  // owner. That is about this recipient, not about Resend being down.
  const testModeOnly = Object.assign(
    new Error('You can only send testing emails to your own email address'),
    { responseCode: 550 },
  )
  const health = memoryHealth()
  const smtp = fakeSmtp({ brevo: testModeOnly, resend: 'ok', gmail: 'ok' })
  const result = await sendWithFailover(message, { providers, ...smtp, health })
  assert.equal(result.provider, 'resend')
  assert.equal(await health.unhealthyUntil('brevo'), null)
})
