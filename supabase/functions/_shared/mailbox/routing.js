// Company email addresses (name@raskosweetscent.com) on Cloudflare Email
// Routing. There are no mailboxes: an address is a forwarding rule to the
// person's own inbox, and Cloudflare will not deliver to that inbox until its
// owner clicks the verification link Cloudflare sends them.
//
// Two callers share these rules: the invite-user, assign-company-email and
// set-user-active functions (Deno), and the app's Users screen, which
// previews the address before the owner sends anything. Plain JS for that
// reason, like b2c.js.

/** RFC 5321 allows more, but a staff address should survive being read aloud. */
export const LOCAL_PART = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
export const MAX_LOCAL_PART = 64

/**
 * Addresses that belong to the business or to mail itself, never to one
 * person: RFC 2142 role mailboxes plus the software's own sender. Handing one
 * to a staff member would redirect mail the whole company depends on.
 */
export const RESERVED_LOCAL_PARTS = new Set([
  'info',
  'admin',
  'administrator',
  'postmaster',
  'hostmaster',
  'webmaster',
  'abuse',
  'security',
  'noc',
  'mailer-daemon',
  'noreply',
  'no-reply',
  'dmarc',
])

/** Every rule this software creates is named so; it never touches any other. */
export const STAFF_RULE_PREFIX = 'Staff: '

/**
 * "Jane Wanjiku Kamau" -> "jane.kamau". First and last name, because that is
 * what a client guesses; the owner can edit it before sending.
 * @param {string} fullName
 */
export function suggestLocalPart(fullName) {
  const words = String(fullName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) return ''
  const joined = words.length === 1 ? words[0] : `${words[0]}.${words[words.length - 1]}`
  return joined.slice(0, MAX_LOCAL_PART).replace(/[._-]+$/, '')
}

/**
 * @param {string} localPart  what the owner typed, before the @
 * @param {string} domain
 * @returns {{ address: string } | { error: string }}
 */
export function companyAddress(localPart, domain) {
  const local = String(localPart ?? '')
    .trim()
    .toLowerCase()
  if (!local) return { error: 'Enter the part of the company address before the @.' }
  if (local.length > MAX_LOCAL_PART) {
    return { error: `Keep the address under ${MAX_LOCAL_PART} characters before the @.` }
  }
  if (!LOCAL_PART.test(local)) {
    return {
      error:
        'Use only letters, numbers and single dots, hyphens or underscores between them, for example jane.kamau.',
    }
  }
  if (RESERVED_LOCAL_PARTS.has(local)) {
    return { error: `${local}@ is a company address, not one for a person. Choose another.` }
  }
  return { address: `${local}@${domain}` }
}

/** @param {string | null | undefined} email @param {string} domain */
export function isCompanyAddress(email, domain) {
  return String(email ?? '')
    .trim()
    .toLowerCase()
    .endsWith(`@${domain.toLowerCase()}`)
}

export class CloudflareError extends Error {
  /** @param {string} message @param {number | null} status */
  constructor(message, status = null) {
    super(message)
    this.name = 'CloudflareError'
    this.status = status
  }
}

const API = 'https://api.cloudflare.com/client/v4'
const PER_PAGE = 50 // Cloudflare's maximum for these listings.
// ponytail: listings stop at 20 pages (1,000 rules or destinations), far past
// a farm's staff; filter server-side if Cloudflare ever offers it.
const MAX_PAGES = 20

/**
 * @param {{ token: string, accountId: string, zoneId: string,
 *           fetch?: typeof fetch, timeoutMs?: number }} config
 */
export function routingClient(config) {
  const doFetch = config.fetch ?? globalThis.fetch
  const timeoutMs = config.timeoutMs ?? 10_000

  async function call(method, path, body) {
    let response
    try {
      response = await doFetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new CloudflareError(`Cloudflare could not be reached (${reason}).`)
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.success) {
      const detail =
        (payload?.errors ?? [])
          .map((e) => e?.message)
          .filter(Boolean)
          .join('; ') || `HTTP ${response.status}`
      throw new CloudflareError(`Cloudflare refused the request: ${detail}`, response.status)
    }
    return payload
  }

  /** Every row across the pages that matches, not just the first. */
  async function findAll(path, predicate) {
    const hits = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = await call('GET', `${path}?page=${page}&per_page=${PER_PAGE}`)
      const rows = Array.isArray(payload.result) ? payload.result : []
      hits.push(...rows.filter(predicate))
      const totalPages = payload.result_info?.total_pages ?? page
      if (rows.length < PER_PAGE || page >= totalPages) break
    }
    return hits
  }

  const addressesPath = `/accounts/${config.accountId}/email/routing/addresses`
  const rulesPath = `/zones/${config.zoneId}/email/routing/rules`

  function rulesFor(address) {
    const target = address.toLowerCase()
    return findAll(rulesPath, (rule) =>
      (rule.matchers ?? []).some(
        (m) => m.type === 'literal' && m.field === 'to' && String(m.value).toLowerCase() === target,
      ),
    )
  }

  const isStaffRule = (rule) => String(rule.name ?? '').startsWith(STAFF_RULE_PREFIX)

  return {
    /**
     * Registers the person's own inbox as a destination. A new one gets
     * Cloudflare's verification email; forwarding waits until it is clicked.
     * @param {string} email
     * @returns {Promise<{ id: string, isVerified: boolean }>}
     */
    async ensureDestination(email) {
      const target = email.toLowerCase()
      const [existing] = await findAll(
        addressesPath,
        (row) => String(row.email).toLowerCase() === target,
      )
      const row = existing ?? (await call('POST', addressesPath, { email: target })).result
      return { id: row.id, isVerified: Boolean(row.verified) }
    },

    /**
     * Creates, or repoints and re-enables, this software's rule for the
     * address. Safe to run twice: a retry after a half-finished invite
     * converges on one rule. Refuses outright when a rule it did not create
     * already routes the address (info@, a hand-made forward): repointing that
     * would hand someone else's mail to this person.
     * @param {string} address @param {string} forwardTo
     * @returns {Promise<string>} the rule id
     */
    async ensureForwardRule(address, forwardTo) {
      const matches = await rulesFor(address)
      const foreign = matches.find((rule) => !isStaffRule(rule))
      if (foreign) {
        throw new CloudflareError(
          `${address} is already routed by another rule in Cloudflare ("${foreign.name || 'unnamed'}"). Choose a different address.`,
          409,
        )
      }
      const existing = matches[0]
      const body = {
        name: `${STAFF_RULE_PREFIX}${address}`,
        enabled: true,
        priority: 0,
        matchers: [{ type: 'literal', field: 'to', value: address }],
        actions: [{ type: 'forward', value: [forwardTo.toLowerCase()] }],
      }
      if (existing) {
        await call('PUT', `${rulesPath}/${existing.id}`, body)
        return existing.id
      }
      return (await call('POST', rulesPath, body)).result.id
    },

    /**
     * Pauses or resumes forwarding, for deactivation. False when the address
     * has no rule of ours (an account from before company addresses existed);
     * a rule someone made by hand is never touched.
     * @param {string} address @param {boolean} enabled
     */
    async setForwarding(address, enabled) {
      const rule = (await rulesFor(address)).find(isStaffRule)
      if (!rule) return false
      await call('PUT', `${rulesPath}/${rule.id}`, {
        name: rule.name,
        enabled,
        priority: rule.priority ?? 0,
        matchers: rule.matchers,
        actions: rule.actions,
      })
      return true
    },
  }
}
