// IntaSend send-money for salary payouts: the pure parts, no network, so they
// are tested directly (intasend.test.mjs). intasendClient.ts does the I/O.
//
// Contract, from developers.intasend.com and the official intasend-node SDK
// (dist/payouts.js, dist/requests.js), checked 2026-09-26:
//   auth      Authorization: Bearer ISSecretKey_test_… | ISSecretKey_live_…
//   initiate  POST {base}/api/v1/send-money/initiate/
//             { currency, provider: MPESA-B2C | PESALINK, requires_approval,
//               callback_url, batch_reference, transactions: [...] }
//   status    POST {base}/api/v1/send-money/status/   { tracking_id }
//   callback  IntaSend POSTs the same shape as the status answer to
//             callback_url each time the batch status changes.
//
// requires_approval is always 'NO': the owner's approval is the typed total
// in the app, and the approve call adds nothing but a second round trip in
// which a payout could be left half-released. So an initiate that reached
// IntaSend may already be moving money.

export const INTASEND_BASE_URL = {
  sandbox: 'https://sandbox.intasend.com',
  production: 'https://payment.intasend.com',
}
export const INITIATE_PATH = '/api/v1/send-money/initiate/'
export const STATUS_PATH = '/api/v1/send-money/status/'

/**
 * Which environment a secret key belongs to. IntaSend puts `test` or `live`
 * in every key, so a live key pointed at the sandbox (or the reverse) is
 * caught before any money is asked for.
 * @param {string} secretKey
 * @returns {'sandbox' | 'production' | null}
 */
export function keyEnvironment(secretKey) {
  const key = String(secretKey ?? '')
  if (!key.startsWith('ISSecretKey_')) return null
  if (/_test_/i.test(key)) return 'sandbox'
  if (/_live_/i.test(key)) return 'production'
  return null
}

/**
 * The initiate body for one payout. One payout, one request: each row is
 * claimed, sent and settled on its own, which is what lets the never-pay-twice
 * rules work per payslip line. `batch_reference` carries our payout id so a
 * transfer in the IntaSend dashboard can be traced to its payslip.
 * @param {{
 *   payoutId: string,
 *   channel: 'mpesa' | 'bank',
 *   amountShillings: number,
 *   name: string,
 *   narrative: string,
 *   callbackUrl: string,
 *   msisdn?: string | null,
 *   bank?: { bankCode: string, accountNumber: string } | null,
 * }} payout
 */
export function sendMoneyBody(payout) {
  const clip = (value, max) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  const base = {
    name: clip(payout.name, 240) || 'Employee',
    amount: String(payout.amountShillings),
    narrative: clip(payout.narrative, 240) || 'Salary',
  }
  const transaction =
    payout.channel === 'bank'
      ? { ...base, account: payout.bank?.accountNumber, bank_code: payout.bank?.bankCode }
      : { ...base, account: payout.msisdn }
  return {
    currency: 'KES',
    provider: payout.channel === 'bank' ? 'PESALINK' : 'MPESA-B2C',
    requires_approval: 'NO',
    callback_url: payout.callbackUrl,
    batch_reference: payout.payoutId,
    transactions: [transaction],
  }
}

// developers.intasend.com/docs/payment-statuses-reference
const BATCH_FAILED = {
  BF102: 'IntaSend could not process the payment request.',
  BF105: 'IntaSend could not confirm enough balance. Top up the IntaSend wallet, then pay again.',
  BF107:
    'IntaSend refused the payment at its balance check. Top up the IntaSend wallet, then pay again.',
  BE111: 'The payment request was cancelled before it was sent.',
}
const TX_FAILED = new Set(['TF103', 'TF106', 'TC108'])
const TX_UNDETERMINED = 'TF105'
const TX_PAID = 'TS100'
const TX_NEW = 'TP101'

/**
 * What IntaSend's answer (initiate, status or callback, all the same shape)
 * means for our payout. Decided from the transaction first: the batch code
 * only settles a payout whose transaction never started.
 *
 *   accepted  still moving; ask again later
 *   paid      money delivered, with a receipt, for exactly the amount sent
 *   failed    refused before any money moved; may be paid again once fixed
 *   unknown   money may have moved; a person checks before anything else
 *
 * @param {unknown} body
 * @param {number} sentShillings
 * @returns {{ status: 'accepted' | 'paid' | 'failed' | 'unknown', trackingId: string | null, resultCode: string | null, description: string, receipt: string | null, recipient: string | null }}
 */
export function interpretStatus(body, sentShillings) {
  const answer = body && typeof body === 'object' ? /** @type {Record<string, any>} */ (body) : {}
  const trackingId = answer.tracking_id ? String(answer.tracking_id) : null
  const batchCode = String(answer.status_code ?? '')
  const transaction = Array.isArray(answer.transactions) ? answer.transactions[0] : null
  const txCode = transaction ? String(transaction.status_code ?? '') : ''
  const reason = String(
    transaction?.failed_reason ??
      transaction?.status_description ??
      transaction?.status ??
      answer.status ??
      '',
  )
    .trim()
    .slice(0, 400)
  const check = 'Check the IntaSend dashboard before paying again.'
  const result = (status, resultCode, description, extra = {}) => ({
    status,
    trackingId,
    resultCode: resultCode || null,
    description: description.slice(0, 500),
    receipt: null,
    recipient: null,
    ...extra,
  })

  if (txCode === TX_PAID) {
    const receipt = String(transaction.provider_reference ?? '').trim() || null
    const paid = Number(transaction.amount)
    if (Number.isFinite(paid) && paid !== sentShillings) {
      return result(
        'unknown',
        txCode,
        `IntaSend reports KES ${paid} paid, but KES ${sentShillings} was sent. ${check}`,
        { receipt },
      )
    }
    if (!receipt) {
      return result('unknown', txCode, `IntaSend reported success without a reference. ${check}`)
    }
    const recipient = String(transaction.provider_account_name ?? '').trim() || null
    return result('paid', txCode, reason || 'Paid.', { receipt, recipient })
  }
  if (TX_FAILED.has(txCode)) return result('failed', txCode, reason || 'The payment failed.')
  if (txCode === TX_UNDETERMINED) {
    return result(
      'unknown',
      txCode,
      `IntaSend cannot tell whether this was paid${reason ? ` (${reason})` : ''}. ${check}`,
    )
  }
  if (BATCH_FAILED[batchCode]) {
    // The batch ended. Only a transaction that never started is safely unpaid.
    const neverStarted = txCode === '' || txCode === TX_NEW
    return neverStarted
      ? result('failed', batchCode, `${BATCH_FAILED[batchCode]}${reason ? ` ${reason}` : ''}`)
      : result(
          'unknown',
          txCode,
          `IntaSend ended the request after the payment started (${batchCode}). ${check}`,
        )
  }
  return result('accepted', txCode || batchCode, reason || 'With IntaSend.')
}

export const WALLETS_PATH = '/api/v1/wallets/'

/**
 * The wallet a send-money request draws from, out of GET /api/v1/wallets/.
 * A request that names no wallet_id draws from the KES settlement wallet (the
 * `wallet` object IntaSend returns with every send-money answer is that one),
 * so that is the balance the owner needs to see. The list may come bare or
 * paginated ({ results: [...] }); both are read.
 * unverified: that the default wallet is always the KES SETTLEMENT wallet;
 * confirm against the `wallet` in the first sandbox send-money answer.
 * @param {unknown} body
 * @returns {{ walletId: string, availableCents: number, updatedAt: string | null } | null}
 */
export function disbursingWallet(body) {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray(/** @type {any} */ (body).results)
      ? /** @type {any} */ (body).results
      : []
  const kes = list.filter((wallet) => wallet && wallet.currency === 'KES')
  const wallet = kes.find((w) => w.wallet_type === 'SETTLEMENT') ?? kes[0]
  if (!wallet) return null
  const available = Number(wallet.available_balance)
  if (!Number.isFinite(available)) return null
  return {
    walletId: String(wallet.wallet_id ?? ''),
    availableCents: Math.round(available * 100),
    updatedAt: wallet.updated_at ? String(wallet.updated_at) : null,
  }
}
