// Types for routing.js, so the app previews a company address with the very
// rules the server applies. Deno reads the JSDoc in routing.js instead.
export const LOCAL_PART: RegExp
export const MAX_LOCAL_PART: number
export const RESERVED_LOCAL_PARTS: ReadonlySet<string>
export const STAFF_RULE_PREFIX: string
export function suggestLocalPart(fullName: string): string
export function companyAddress(
  localPart: string,
  domain: string,
): { address: string; error?: undefined } | { error: string; address?: undefined }
export function isCompanyAddress(email: string | null | undefined, domain: string): boolean
export class CloudflareError extends Error {
  readonly status: number | null
}
export interface RoutingClient {
  ensureDestination(email: string): Promise<{ id: string; isVerified: boolean }>
  ensureForwardRule(address: string, forwardTo: string): Promise<string>
  setForwarding(address: string, enabled: boolean): Promise<boolean>
  removeForwarding(address: string): Promise<boolean>
}
export function routingClient(config: {
  token: string
  accountId: string
  zoneId: string
  fetch?: typeof fetch
  timeoutMs?: number
}): RoutingClient
