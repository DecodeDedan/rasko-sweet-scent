// Sends one message through the first healthy provider, failing over to the
// next the moment one refuses. Used by send-email (client email) and
// send-auth-email (Supabase Auth's Send Email Hook), so resets, invitations
// and invoices all share the same failover.
//
// ORDER AND FAILOVER
// Providers are tried in EMAIL_PROVIDERS order (default brevo, resend, gmail).
// A provider that fails for a reason the next provider would not share
// (cannot connect, bad login, daily quota, rate limit, 4xx "try later") is
// marked unhealthy and the next is tried in the same call. A failure every
// provider would share (the recipient address does not exist) stops the
// attempt instead of burning through all three.
//
// "IN MILLISECONDS"
// The expensive part of a failover is waiting on a dead provider. So health is
// remembered: an unhealthy provider is skipped outright until its cooldown
// ends. Quota exhaustion cools down for an hour, anything else for two
// minutes, after which it is tried again. The health store is passed in
// (the functions back it with app.email_provider_health), so every function
// instance skips the same dead provider without first timing out on it.
//
// Plain JavaScript so node:test can exercise the failover with fake senders
// (transport.test.mjs); Deno imports it unchanged.

export const QUOTA_COOLDOWN_MS = 60 * 60 * 1000
export const FAULT_COOLDOWN_MS = 2 * 60 * 1000
/** A dead SMTP host should cost seconds, not a minute, before the next is tried. */
export const CONNECT_TIMEOUT_MS = 4000
export const SOCKET_TIMEOUT_MS = 12000

/**
 * @typedef {{ name: string, from: string, transport: Record<string, unknown> }} Provider
 * @typedef {{ to: string | { name: string, address: string }, subject: string, html: string, text: string, replyTo?: string }} Message
 * @typedef {(transport: Record<string, unknown>) => { sendMail: (message: Record<string, unknown>) => Promise<{ messageId?: string }> }} CreateTransport
 * @typedef {{ unhealthyUntil: (name: string) => Promise<number | null>, markUnhealthy: (name: string, untilMs: number, reason: string) => Promise<void>, markHealthy: (name: string) => Promise<void> }} HealthStore
 */

const smtp = (host, port, user, pass) => ({
  host,
  port,
  secure: port === 465,
  auth: user ? { user, pass } : undefined,
  connectionTimeout: CONNECT_TIMEOUT_MS,
  greetingTimeout: CONNECT_TIMEOUT_MS,
  socketTimeout: SOCKET_TIMEOUT_MS,
})

/**
 * The providers this environment has credentials for, in order. A provider
 * with a missing credential is left out rather than tried and failed.
 * @param {(name: string) => string | undefined} env
 * @returns {Provider[]}
 */
export function configuredProviders(env) {
  const get = (name) => env(name)?.trim() || undefined
  const defaultFrom = get('EMAIL_FROM')
  const available = {
    brevo:
      get('BREVO_SMTP_USER') && get('BREVO_SMTP_KEY')
        ? {
            name: 'brevo',
            from: get('BREVO_FROM') ?? defaultFrom,
            transport: smtp(
              'smtp-relay.brevo.com',
              587,
              get('BREVO_SMTP_USER'),
              get('BREVO_SMTP_KEY'),
            ),
          }
        : null,
    resend: get('RESEND_API_KEY')
      ? {
          name: 'resend',
          from: get('RESEND_FROM') ?? defaultFrom,
          transport: smtp('smtp.resend.com', 465, 'resend', get('RESEND_API_KEY')),
        }
      : null,
    gmail:
      get('GMAIL_USER') && get('GMAIL_APP_PASSWORD')
        ? {
            name: 'gmail',
            // Gmail rewrites any other From to the account itself.
            from: get('GMAIL_FROM') ?? `Rasko Sweet Scent <${get('GMAIL_USER')}>`,
            transport: smtp('smtp.gmail.com', 465, get('GMAIL_USER'), get('GMAIL_APP_PASSWORD')),
          }
        : null,
  }

  const order = (get('EMAIL_PROVIDERS') ?? 'brevo,resend,gmail')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  const real = order.flatMap((name) => {
    const provider = available[name]
    return provider && provider.from ? [provider] : []
  })
  if (real.length > 0) return real

  // No real provider configured: the local stack's Mailpit, so development
  // still works. Never used alongside a real provider, where "delivered to
  // Mailpit" would be reported as success for mail no one receives.
  const catcher = get('SMTP_HOST')
  return catcher && defaultFrom
    ? [
        {
          name: 'mailpit',
          from: defaultFrom,
          transport: smtp(catcher, Number(get('SMTP_PORT') ?? 1025)),
        },
      ]
    : []
}

const responseText = (error) => String(error?.response ?? error?.message ?? error ?? '')

/**
 * Whether an error is about the message itself (every provider would refuse
 * it) rather than about the provider: 550 5.1.1 and friends, no such mailbox.
 * @param {unknown} error
 */
export function isRecipientError(error) {
  const code = Number(error?.responseCode)
  return (
    (code === 550 || code === 553) &&
    /5\.1\.[0-9]|no such user|does not exist|invalid (recipient|address)/i.test(responseText(error))
  )
}

/**
 * This provider will not send to this address, though it is working and
 * another provider may: Resend's test sender delivers only to the account
 * owner, and an unverified sender domain is refused per message. The next
 * provider is tried, and this one is not benched for everybody else.
 * @param {unknown} error
 */
export function isSenderRestriction(error) {
  return /only send testing emails|verify a domain|domain is not verified|sender (address )?(is )?not (verified|allowed)/i.test(
    responseText(error),
  )
}

/**
 * Quota and rate limits get the long cooldown: a provider over its daily cap
 * will not recover in two minutes.
 * @param {unknown} error
 */
export function isQuotaError(error) {
  const code = Number(error?.responseCode)
  return (
    code === 421 ||
    code === 452 ||
    code === 454 ||
    /quota|limit|too many|rate/i.test(responseText(error))
  )
}

/**
 * @param {Message} message
 * @param {{ providers: Provider[], createTransport: CreateTransport, health: HealthStore, now?: () => number, log?: (line: string) => void }} deps
 * @returns {Promise<{ provider: string, messageId: string | null, skipped: string[], failed: Array<{ provider: string, reason: string }> }>}
 */
export async function sendWithFailover(message, deps) {
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  if (deps.providers.length === 0) {
    throw new Error('No email provider is configured. See docs/email-setup.md.')
  }

  const skipped = []
  const failed = []
  const tryProvider = async (provider) => {
    try {
      const info = await deps
        .createTransport(provider.transport)
        .sendMail({ ...message, from: provider.from })
      await deps.health.markHealthy(provider.name)
      return { provider: provider.name, messageId: info?.messageId ?? null, skipped, failed }
    } catch (error) {
      const reason = responseText(error).slice(0, 300)
      if (isSenderRestriction(error)) {
        failed.push({ provider: provider.name, reason })
        log(`email: ${provider.name} may not send to this address, trying the next: ${reason}`)
        return null
      }
      if (isRecipientError(error)) {
        throw Object.assign(new Error(`The address was refused: ${reason}`), { permanent: true })
      }
      const cooldown = isQuotaError(error) ? QUOTA_COOLDOWN_MS : FAULT_COOLDOWN_MS
      await deps.health.markUnhealthy(provider.name, now() + cooldown, reason)
      failed.push({ provider: provider.name, reason })
      log(`email: ${provider.name} failed, failing over: ${reason}`)
      return null
    }
  }

  // Healthy providers first, in order. Only if all of them fail are the
  // resting ones tried, soonest-to-recover first: better a retry of a resting
  // provider than no email at all.
  const resting = []
  for (const provider of deps.providers) {
    const until = await deps.health.unhealthyUntil(provider.name)
    if (until !== null && until > now()) {
      skipped.push(provider.name)
      resting.push({ provider, until })
      continue
    }
    const sent = await tryProvider(provider)
    if (sent) return sent
  }
  for (const { provider } of resting.sort((a, b) => a.until - b.until)) {
    const sent = await tryProvider(provider)
    if (sent) return sent
  }

  throw new Error(
    `Every email provider failed: ${failed.map((f) => `${f.provider} (${f.reason})`).join('; ')}`,
  )
}

/** An in-process health store: for tests, and the fallback when the database is unreachable. */
export function memoryHealth() {
  const until = new Map()
  return {
    unhealthyUntil: async (name) => until.get(name) ?? null,
    markUnhealthy: async (name, ms) => {
      until.set(name, ms)
    },
    markHealthy: async (name) => {
      until.delete(name)
    },
  }
}
