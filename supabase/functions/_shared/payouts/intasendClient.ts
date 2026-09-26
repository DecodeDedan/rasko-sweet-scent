// IntaSend I/O for salary payouts (migration 20260929000100): send one
// claimed payout, and ask IntaSend what became of one. Used by mpesa-b2c (the
// dispatcher) and payout-result (the callback). The decisions themselves are
// pure and tested in intasend.js.
//
// WHEN MONEY MAY HAVE MOVED, STOP (the rule of mpesa-b2c, unchanged)
// requires_approval is 'NO', so an initiate that reached IntaSend may already
// be paying. A timeout or a 5xx on initiate is therefore 'unknown', never
// retried automatically. Only a clear refusal (4xx) is 'failed'.
//
// A CALLBACK IS A HINT, NEVER A VERDICT
// Nothing IntaSend's callback body says is written as it stands. The payout is
// only ever settled from IntaSend's own status answer, fetched here with our
// secret key, and only when that answer is provably about this payout: its
// batch_reference is our payout id, or its tracking_id is the one IntaSend
// gave us when we sent it.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  INITIATE_PATH,
  INTASEND_BASE_URL,
  STATUS_PATH,
  interpretStatus,
  keyEnvironment,
  sendMoneyBody,
} from './intasend.js'
import { bankAccount } from './rules.js'

const REQUEST_TIMEOUT_MS = 20_000
const STATUS_TIMEOUT_MS = 10_000
/** A payout IntaSend may still settle. Anything else is finished. */
export const IN_FLIGHT = ['sending', 'accepted', 'unknown']

export interface IntasendConfig {
  baseUrl: string
  secretKey: string
  callbackUrl: string
}

/**
 * Every value from function secrets. `error` names what is missing or wrong;
 * while it is set, payouts wait queued and nothing is sent.
 */
export function intasendConfig(): { config: IntasendConfig } | { error: string } {
  const get = (name: string) => Deno.env.get(name)?.trim() || null
  const secretKey = get('INTASEND_SECRET_KEY')
  const callbackBase = get('MPESA_CALLBACK_BASE_URL')?.replace(/\/+$/, '')
  const token = get('MPESA_CALLBACK_TOKEN')
  if (!secretKey) return { error: 'INTASEND_SECRET_KEY is not set.' }
  if (!callbackBase || !token) {
    return { error: 'MPESA_CALLBACK_BASE_URL and MPESA_CALLBACK_TOKEN must be set.' }
  }
  const keyEnv = keyEnvironment(secretKey)
  if (!keyEnv) return { error: 'INTASEND_SECRET_KEY is not an IntaSend secret key.' }
  // A stated environment must agree with the key, so a live key is never
  // used while someone believes they are testing.
  const statedEnv = get('INTASEND_ENV')
  if (statedEnv && statedEnv !== keyEnv) {
    return { error: `INTASEND_ENV is ${statedEnv} but the key is a ${keyEnv} key.` }
  }
  return {
    config: {
      baseUrl: INTASEND_BASE_URL[keyEnv],
      secretKey,
      // Trailing slash: see RESULT_FUNCTION in mpesa-b2c/index.ts.
      callbackUrl: `${callbackBase}/payout-result/intasend/${token}/`,
    },
  }
}

export interface ClaimedPayout {
  id: string
  payroll_run_id: string
  employee_id: string | null
  amount_cents: number | string
  msisdn: string | null
  channel: 'mpesa' | 'bank'
  bank_code: string | null
  bank_account: string | null
  conversation_id: string | null
  status: string
}

async function record(admin: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await admin
    .from('payroll_payouts')
    .update(patch)
    .eq('id', id)
    .in('status', IN_FLIGHT)
  if (error) console.error(`intasend: could not record ${id}: ${error.message}`)
}

/** The patch that writes an interpreted answer onto the row. */
function patchFor(answer: ReturnType<typeof interpretStatus>): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    status: answer.status,
    result_code: answer.resultCode,
    result_desc: answer.description,
  }
  if (answer.trackingId) patch.conversation_id = answer.trackingId
  if (answer.receipt) patch.mpesa_receipt = answer.receipt
  if (answer.status === 'paid') {
    patch.recipient_name = answer.recipient
    patch.settled_at = new Date().toISOString()
  }
  return patch
}

function headers(config: IntasendConfig) {
  return { Authorization: `Bearer ${config.secretKey}`, 'Content-Type': 'application/json' }
}

/** Sends a payout already claimed into 'sending'. Returns the status it ends in. */
export async function sendIntasendPayout(
  admin: SupabaseClient,
  config: IntasendConfig,
  payout: ClaimedPayout,
  narrative: string,
): Promise<string> {
  const { data: employee } = await admin
    .from('employees')
    .select('full_name, payment_details')
    .eq('id', payout.employee_id)
    .maybeSingle()
  const accountName = bankAccount(employee?.payment_details)?.accountName
  const sentShillings = Number(payout.amount_cents) / 100

  const body = sendMoneyBody({
    payoutId: payout.id,
    channel: payout.channel,
    amountShillings: sentShillings,
    msisdn: payout.msisdn,
    bank:
      payout.channel === 'bank' && payout.bank_code && payout.bank_account
        ? { bankCode: payout.bank_code, accountNumber: payout.bank_account }
        : null,
    name: (payout.channel === 'bank' && accountName) || employee?.full_name || 'Employee',
    narrative,
    callbackUrl: config.callbackUrl,
  })

  // ---- From here the request may reach IntaSend, and money may move.
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${INITIATE_PATH}`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    await record(admin, payout.id, {
      status: 'unknown',
      result_desc:
        `No answer from IntaSend (${reason}). Check the IntaSend dashboard before paying again.`.slice(
          0,
          500,
        ),
    })
    return 'unknown'
  }

  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (response.ok && answer && answer.tracking_id) {
    const interpreted = interpretStatus(answer, sentShillings)
    await record(admin, payout.id, patchFor(interpreted))
    return interpreted.status
  }

  // A clear refusal (4xx) moved no money and can be retried once fixed. A 5xx,
  // or a 2xx without a tracking id, is not clear, so it is 'unknown'.
  const isRefused = response.status >= 400 && response.status < 500
  const detail = answer
    ? JSON.stringify(answer.errors ?? answer.detail ?? answer).slice(0, 300)
    : `HTTP ${response.status}`
  await record(admin, payout.id, {
    status: isRefused ? 'failed' : 'unknown',
    result_code: String(response.status),
    result_desc: (isRefused
      ? `IntaSend refused the payment: ${detail}`
      : `IntaSend answered unclearly (${detail}). Check the IntaSend dashboard before paying again.`
    ).slice(0, 500),
  })
  return isRefused ? 'failed' : 'unknown'
}

/**
 * Asks IntaSend what became of an in-flight payout and records the answer.
 * `trackingId` defaults to the one stored when the payout was sent; the
 * callback may offer one before that was stored, which is accepted only if
 * IntaSend's answer names this payout as its batch_reference.
 */
export async function reconcileIntasendPayout(
  admin: SupabaseClient,
  config: IntasendConfig,
  payout: ClaimedPayout,
  offeredTrackingId?: string | null,
): Promise<string> {
  const trackingId = payout.conversation_id ?? offeredTrackingId ?? null
  if (!trackingId) return payout.status

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${STATUS_PATH}`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ tracking_id: trackingId }),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    })
  } catch (cause) {
    console.warn(`intasend: status check for ${payout.id} failed: ${String(cause)}`)
    return payout.status
  }
  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok || !answer) {
    console.warn(`intasend: status check for ${payout.id} answered HTTP ${response.status}`)
    return payout.status
  }

  const isOurs =
    answer.batch_reference === payout.id ||
    (payout.conversation_id !== null && answer.tracking_id === payout.conversation_id)
  if (!isOurs) {
    console.warn(`intasend: status for ${trackingId} is not about payout ${payout.id}; ignored`)
    return payout.status
  }

  const interpreted = interpretStatus(answer, Number(payout.amount_cents) / 100)
  // An 'unknown' payout is never downgraded to still-moving by a later read;
  // it waits for a person unless IntaSend now gives a final answer.
  if (payout.status === 'unknown' && interpreted.status === 'accepted') return payout.status
  await record(admin, payout.id, patchFor(interpreted))
  return interpreted.status
}
