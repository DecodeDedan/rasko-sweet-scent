// Types for b2c.js, so the app previews a payout with the very rules the
// server applies. Deno reads the JSDoc in b2c.js instead.
export const B2C_MIN_SHILLINGS: number
export const B2C_MAX_SHILLINGS: number
export function payoutAmount(netPayCents: number): {
  amountShillings: number
  amountCents: number
  remainderCents: number
}
export function toMsisdn(phone: string | null | undefined): string | null
export function payoutBlocker(item: {
  netPayCents: number
  msisdn: string | null
  paymentMethod: string | null
  isPaid: boolean
}): string | null
