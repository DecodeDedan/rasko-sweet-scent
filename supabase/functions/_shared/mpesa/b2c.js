// M-Pesa B2C (Daraja) for salary payouts: the pure parts, no network, so they
// are tested directly (b2c.test.mjs, `node --test`). The functions mpesa-b2c
// and payout-result do the I/O.
//
// Contract, as documented by Safaricom Daraja (verify against the portal on
// the first sandbox run; the path is overridable with MPESA_B2C_PATH):
//   token    GET  {base}/oauth/v1/generate?grant_type=client_credentials  (Basic key:secret)
//   request  POST {base}/mpesa/b2c/v3/paymentrequest                      (Bearer token)
//   result   Safaricom POSTs { Result: { ResultCode, OriginatorConversationID,
//            ConversationID, TransactionID, ResultParameters: { ResultParameter: [{Key, Value}] } } }
//            to the ResultURL; a queue timeout POSTs to the QueueTimeOutURL.

export const MPESA_BASE_URL = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
}
export const DEFAULT_B2C_PATH = '/mpesa/b2c/v3/paymentrequest'

/**
 * Safaricom's per-transaction B2C bounds in shillings. Provider limits, not
 * business settings: a salary above the ceiling has to go by bank.
 * unverified: current Daraja B2C limits; confirm with Safaricom when the
 * shortcode is approved.
 */
export const B2C_MIN_SHILLINGS = 10
export const B2C_MAX_SHILLINGS = 250000

/**
 * B2C sends whole shillings. The payout is net pay rounded DOWN, so M-Pesa
 * never overpays; the cents left over are reported, to be settled another way.
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
 * 2547XXXXXXXX form Daraja wants. Anything else is refused rather than guessed.
 * @param {string | null | undefined} phone
 * @returns {string | null}
 */
export function toMsisdn(phone) {
  const digits = String(phone ?? '').replace(/[\s-]/g, '')
  const match = /^(?:\+?254|0)([17]\d{8})$/.exec(digits)
  return match ? `254${match[1]}` : null
}

/**
 * Why an item cannot be paid by M-Pesa, or null if it can.
 * @param {{ netPayCents: number, msisdn: string | null, paymentMethod: string | null, isPaid: boolean }} item
 */
export function payoutBlocker(item) {
  if (item.isPaid) return 'Already paid.'
  if (item.paymentMethod !== 'mpesa') return 'Paid by bank, not M-Pesa.'
  if (!item.msisdn) return 'No valid M-Pesa number on the employee record.'
  const { amountShillings } = payoutAmount(item.netPayCents)
  if (amountShillings < B2C_MIN_SHILLINGS) {
    return `Below the M-Pesa minimum of KES ${B2C_MIN_SHILLINGS}.`
  }
  if (amountShillings > B2C_MAX_SHILLINGS) {
    return `Above the M-Pesa limit of KES ${B2C_MAX_SHILLINGS.toLocaleString('en-KE')}; pay by bank.`
  }
  return null
}

/**
 * The B2C request body. `payoutId` is our row id and becomes the
 * OriginatorConversationID, Safaricom's idempotency key and the id the result
 * callback carries back.
 * @param {{ initiatorName: string, securityCredential: string, shortcode: string, resultUrl: string, timeoutUrl: string }} config
 * @param {{ payoutId: string, amountShillings: number, msisdn: string, remarks: string, occasion?: string }} payout
 */
export function b2cRequestBody(config, payout) {
  // Daraja caps both free-text fields at 100 characters.
  const clip = (value) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100)
  return {
    OriginatorConversationID: payout.payoutId,
    InitiatorName: config.initiatorName,
    SecurityCredential: config.securityCredential,
    CommandID: 'SalaryPayment',
    Amount: payout.amountShillings,
    PartyA: config.shortcode,
    PartyB: payout.msisdn,
    Remarks: clip(payout.remarks) || 'Salary',
    QueueTimeOutURL: config.timeoutUrl,
    ResultURL: config.resultUrl,
    Occasion: clip(payout.occasion ?? ''),
  }
}

/**
 * The asynchronous result Safaricom posts back.
 * @param {unknown} body
 * @returns {{ originatorId: string, conversationId: string | null, isSuccess: boolean, resultCode: string, description: string, receipt: string | null, amountShillings: number | null, recipient: string | null } | null}
 *   null when the body is not a B2C result at all.
 */
export function parseResult(body) {
  const result = body && typeof body === 'object' ? body.Result : null
  if (!result || typeof result !== 'object') return null
  const originatorId = String(result.OriginatorConversationID ?? '').trim()
  if (!originatorId) return null

  const raw = result.ResultParameters?.ResultParameter
  const params = Array.isArray(raw) ? raw : raw ? [raw] : []
  const param = (key) => params.find((p) => p?.Key === key)?.Value ?? null

  const resultCode = String(result.ResultCode ?? '').trim()
  const amount = Number(param('TransactionAmount'))
  const receipt = param('TransactionReceipt') ?? result.TransactionID ?? null
  const recipient = param('ReceiverPartyPublicName')
  return {
    originatorId,
    conversationId: result.ConversationID ? String(result.ConversationID) : null,
    isSuccess: resultCode === '0',
    resultCode,
    description: String(result.ResultDesc ?? '').slice(0, 500),
    receipt: receipt === null ? null : String(receipt),
    amountShillings: param('TransactionAmount') !== null && Number.isFinite(amount) ? amount : null,
    recipient: recipient === null ? null : String(recipient),
  }
}
