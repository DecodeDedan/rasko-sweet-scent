// Salary payout rules shared by the server (mpesa-b2c, payout-result) and the
// app's payout preview, so the plan the owner confirms is the payout the
// server makes. Pure: no network, tested with `node --test` (rules.test.mjs).
//
// app.prepare_payroll_payout (migration 20260929000100) applies the same
// limits and formats in SQL; change one and you must change the other.

/**
 * Safaricom's per-transaction B2C bounds in shillings. Provider limits, not
 * business settings: a salary above the ceiling has to go by bank.
 * unverified: current Daraja B2C limits; confirm with Safaricom when the
 * shortcode is approved.
 */
export const B2C_MIN_SHILLINGS = 10
export const B2C_MAX_SHILLINGS = 250000

/** PesaLink bounds through IntaSend (developers.intasend.com/docs/bank). */
export const BANK_MIN_SHILLINGS = 100
export const BANK_MAX_SHILLINGS = 999999

/**
 * Kenyan banks IntaSend reaches by PesaLink, from
 * GET /api/v1/send-money/bank-codes/ke/ as documented on 2026-09-26. The code
 * is what matters; names are tidied for display. A bank missing here can be
 * added from that endpoint without touching anything else.
 */
export const KENYA_BANKS = [
  { code: '35', name: 'ABC Bank' },
  { code: '3', name: 'Absa Bank (Barclays)' },
  { code: '19', name: 'Bank of Africa' },
  { code: '16', name: 'Citibank' },
  { code: '23', name: 'Consolidated Bank' },
  { code: '11', name: 'Co-operative Bank' },
  { code: '25', name: 'Credit Bank' },
  { code: '63', name: 'Diamond Trust Bank (DTB)' },
  { code: '68', name: 'Equity Bank' },
  { code: '70', name: 'Family Bank' },
  { code: '74', name: 'First Community Bank' },
  { code: '53', name: 'Guaranty Trust Bank' },
  { code: '55', name: 'Guardian Bank' },
  { code: '72', name: 'Gulf African Bank' },
  { code: '17', name: 'Habib Bank AG Zurich' },
  { code: '61', name: 'HFC (Housing Finance)' },
  { code: '57', name: 'I&M Bank' },
  { code: '51', name: 'Jamii Bora Bank' },
  { code: '1', name: 'KCB Bank' },
  { code: '78', name: 'KWFT Bank' },
  { code: '65', name: 'Mayfair Bank' },
  { code: '18', name: 'Middle East Bank' },
  { code: '12', name: 'National Bank of Kenya' },
  { code: '7', name: 'NCBA Bank' },
  { code: '50', name: 'Paramount Bank' },
  { code: '10', name: 'Prime Bank' },
  { code: '66', name: 'Sidian Bank' },
  { code: '49', name: 'Spire Bank' },
  { code: '31', name: 'Stanbic Bank' },
  { code: '2', name: 'Standard Chartered Bank' },
  { code: '54', name: 'Victoria Commercial Bank' },
]

/** @param {string | null | undefined} code */
export function bankName(code) {
  return KENYA_BANKS.find((bank) => bank.code === String(code ?? ''))?.name ?? null
}

/**
 * Payouts send whole shillings. The payout is net pay rounded DOWN, so a
 * payout never overpays; the cents left over are reported, to be settled
 * another way.
 * @param {number} netPayCents
 * @returns {{ amountShillings: number, amountCents: number, remainderCents: number }}
 */
export function payoutAmount(netPayCents) {
  const net = Math.max(0, Math.trunc(Number(netPayCents) || 0))
  const amountShillings = Math.floor(net / 100)
  return {
    amountShillings,
    amountCents: amountShillings * 100,
    remainderCents: net - amountShillings * 100,
  }
}

/**
 * The stored phone (+2547XXXXXXXX, enforced by the employees CHECK) as the
 * 2547XXXXXXXX form both providers want. Anything else is refused rather
 * than guessed.
 * @param {string | null | undefined} phone
 * @returns {string | null}
 */
export function toMsisdn(phone) {
  const digits = String(phone ?? '').replace(/[\s-]/g, '')
  const match = /^(?:\+?254|0)([17]\d{8})$/.exec(digits)
  return match ? `254${match[1]}` : null
}

/**
 * The bank account on an employee's `payment_details`, normalised, or null
 * when it is incomplete. Shape written by the employee form:
 * { bank_code: "68", account_number: "0123456789", account_name: "Jane Wanjiku" }.
 * The account name is optional; the employee's own name stands in for it.
 * @param {unknown} details
 * @returns {{ bankCode: string, accountNumber: string, accountName: string | null } | null}
 */
export function bankAccount(details) {
  if (!details || typeof details !== 'object') return null
  const record = /** @type {Record<string, unknown>} */ (details)
  const bankCode = String(record.bank_code ?? '').trim()
  const accountNumber = String(record.account_number ?? '').replace(/[\s-]/g, '')
  const accountName = String(record.account_name ?? '').trim()
  if (!/^\d{1,4}$/.test(bankCode)) return null
  if (!/^[0-9A-Za-z]{5,24}$/.test(accountNumber)) return null
  return { bankCode, accountNumber, accountName: accountName ? accountName.slice(0, 240) : null }
}

const shillings = (value) => `KES ${value.toLocaleString('en-KE')}`

/**
 * Why a payslip line cannot be paid out, or null if it can.
 * @param {{ netPayCents: number, msisdn: string | null, paymentMethod: string | null, isPaid: boolean, bank?: { bankCode: string, accountNumber: string } | null }} item
 */
export function payoutBlocker(item) {
  if (item.isPaid) return 'Already paid.'
  const { amountShillings } = payoutAmount(item.netPayCents)

  if (item.paymentMethod === 'bank') {
    if (!item.bank) return 'No complete bank account on the employee record.'
    if (amountShillings < BANK_MIN_SHILLINGS) {
      return `Below the bank transfer minimum of ${shillings(BANK_MIN_SHILLINGS)}.`
    }
    if (amountShillings > BANK_MAX_SHILLINGS) {
      return `Above the bank transfer limit of ${shillings(BANK_MAX_SHILLINGS)}.`
    }
    return null
  }

  if (item.paymentMethod !== 'mpesa') return 'No payment method on the employee record.'
  if (!item.msisdn) return 'No valid M-Pesa number on the employee record.'
  if (amountShillings < B2C_MIN_SHILLINGS) {
    return `Below the M-Pesa minimum of ${shillings(B2C_MIN_SHILLINGS)}.`
  }
  if (amountShillings > B2C_MAX_SHILLINGS) {
    return `Above the M-Pesa limit of ${shillings(B2C_MAX_SHILLINGS)}; pay by bank.`
  }
  return null
}
