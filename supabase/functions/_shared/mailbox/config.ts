// Deno glue for routing.js: company email settings from function secrets.
// Null while any is missing, so a function can refuse clearly instead of
// half-creating an account whose address forwards nowhere.
import { routingClient, type RoutingClient } from './routing.js'

export interface Mailboxes {
  /** e.g. raskosweetscent.com */
  domain: string
  routing: RoutingClient
}

export const MAILBOXES_NOT_CONFIGURED =
  'Company email is not set up on the server yet (docs/company-email.md).'

export function mailboxes(): Mailboxes | null {
  const get = (name: string) => Deno.env.get(name)?.trim() || null
  const domain = get('STAFF_EMAIL_DOMAIN')?.toLowerCase()
  const token = get('CLOUDFLARE_API_TOKEN')
  const accountId = get('CLOUDFLARE_ACCOUNT_ID')
  const zoneId = get('CLOUDFLARE_ZONE_ID')
  if (!domain || !token || !accountId || !zoneId) return null
  return { domain, routing: routingClient({ token, accountId, zoneId }) }
}

/** Personal inboxes only: a company address cannot forward to itself. */
export function isPersonalEmail(email: string, domain: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith(`@${domain}`)
}
