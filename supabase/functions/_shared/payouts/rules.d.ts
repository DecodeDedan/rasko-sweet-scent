// Types for rules.js, so the app previews a payout with the very rules the
// server applies. Deno reads the JSDoc in rules.js instead.
export const B2C_MIN_SHILLINGS: number
export const B2C_MAX_SHILLINGS: number
export const BANK_MIN_SHILLINGS: number
export const BANK_MAX_SHILLINGS: number
export const KENYA_BANKS: ReadonlyArray<{ code: string; name: string }>
export function bankName(code: string | null | undefined): string | null
export function payoutAmount(netPayCents: number): {
  amountShillings: number
  amountCents: number
  remainderCents: number
}
export function toMsisdn(phone: string | null | undefined): string | null
export function bankAccount(
  details: unknown,
): { bankCode: string; accountNumber: string; accountName: string | null } | null
export function payoutBlocker(item: {
  netPayCents: number
  msisdn: string | null
  paymentMethod: string | null
  isPaid: boolean
  bank?: { bankCode: string; accountNumber: string } | null
}): string | null
