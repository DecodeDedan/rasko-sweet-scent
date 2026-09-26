// Receives Safaricom's asynchronous answer to a salary payout (ResultURL and
// QueueTimeOutURL of mpesa-b2c). Public by necessity: Safaricom cannot send a
// Supabase JWT, so verify_jwt is off.
//
// TRUST
//   * the URL carries MPESA_CALLBACK_TOKEN, a long random secret known only to
//     this project and to the ResultURL we gave Safaricom; a request without
//     it is refused before its body is read. It travels in the PATH
//     (/payout-result/result/<token>): Daraja does not call back to URLs with
//     a query string. The old ?kind=&token= form is still read, for payouts
//     sent before the change;
//   * only a payout that is actually in flight ('sending', 'accepted',
//     'unknown') can be settled, and only by its own id, so a replayed or
//     forged callback cannot touch a finished payout;
//   * an answer that does not add up (a queue timeout, or a paid amount that
//     differs from what was sent) is set to 'unknown' for a person to check,
//     never guessed into 'paid' or 'failed'.
//
// Safaricom retries a callback it thinks failed, so this always answers 200
// once the token checks out, even for an id it does not recognise.
//
// IntaSend (migration 20260929000100) calls /payout-result/intasend/<token>/,
// the callback_url given with each payout. Its body is only a hint of which
// payout changed: the function looks that payout up and asks IntaSend itself
// for the status (intasendClient.ts), so a forged body cannot settle anything.
import { type SupabaseClient, createClient } from 'jsr:@supabase/supabase-js@2'

import { parseResult } from '../_shared/mpesa/b2c.js'
import {
  type ClaimedPayout,
  IN_FLIGHT as INTASEND_IN_FLIGHT,
  intasendConfig,
  reconcileIntasendPayout,
} from '../_shared/payouts/intasendClient.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACK = { ResultCode: 0, ResultDesc: 'Accepted' }
const IN_FLIGHT = ['sending', 'accepted', 'unknown']

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Constant-time comparison, so the token cannot be guessed a byte at a time. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let difference = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return difference === 0
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply({ error: 'POST only.' }, 405)

  const expected = Deno.env.get('MPESA_CALLBACK_TOKEN')
  const callbackUrl = new URL(request.url)
  // .../payout-result/<kind>/<token>, or the older ?kind=&token=.
  const [pathKind, pathToken] = callbackUrl.pathname.split('/').filter(Boolean).slice(-2)
  const hasPath = pathKind === 'result' || pathKind === 'timeout' || pathKind === 'intasend'
  const token = hasPath ? (pathToken ?? '') : (callbackUrl.searchParams.get('token') ?? '')
  const kind = hasPath ? pathKind : callbackUrl.searchParams.get('kind')
  if (!expected || !sameSecret(token, expected)) {
    return reply({ error: 'Forbidden.' }, 403)
  }
  const isTimeout = kind === 'timeout'

  const body = await request.json().catch(() => null)
  if (kind === 'intasend') return intasendHint(body)
  const result = parseResult(body)
  // Our payout id comes back as OriginatorConversationID on the v3 endpoint.
  // Should an answer carry Safaricom's own id instead, the ConversationID that
  // mpesa-b2c stored when M-Pesa accepted the request identifies it just as
  // uniquely.
  const byOurId = result !== null && UUID.test(result.originatorId)
  if (!result || (!byOurId && !result.conversationId)) {
    console.warn('payout-result: ignored a body that is not a result for one of our payouts')
    return reply(ACK)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return reply({ error: 'Not configured.' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: payout, error } = await admin
    .from('payroll_payouts')
    .select('id, status, amount_cents')
    .eq(byOurId ? 'id' : 'conversation_id', byOurId ? result.originatorId : result.conversationId)
    .maybeSingle()
  if (error) return reply({ error: error.message }, 500)
  if (!payout || !IN_FLIGHT.includes(payout.status)) {
    console.warn(`payout-result: ${result.originatorId} is not in flight; ignored`)
    return reply(ACK)
  }

  const sentShillings = Number(payout.amount_cents) / 100
  const check = 'Check the M-Pesa statement before paying again.'
  let patch: Record<string, unknown>
  if (isTimeout) {
    patch = {
      status: 'unknown',
      result_code: result.resultCode,
      result_desc: `M-Pesa reported a queue timeout: ${result.description} ${check}`.slice(0, 500),
    }
  } else if (!result.isSuccess) {
    patch = { status: 'failed', result_code: result.resultCode, result_desc: result.description }
  } else if (result.amountShillings !== null && result.amountShillings !== sentShillings) {
    patch = {
      status: 'unknown',
      result_code: result.resultCode,
      mpesa_receipt: result.receipt,
      result_desc: `M-Pesa reports KES ${result.amountShillings} paid, but KES ${sentShillings} was sent. Check before settling.`,
    }
  } else if (!result.receipt) {
    patch = {
      status: 'unknown',
      result_code: result.resultCode,
      result_desc: `M-Pesa reported success without a receipt number. ${check}`,
    }
  } else {
    patch = {
      status: 'paid',
      result_code: result.resultCode,
      result_desc: result.description,
      mpesa_receipt: result.receipt,
      recipient_name: result.recipient,
      conversation_id: result.conversationId,
      settled_at: new Date().toISOString(),
    }
  }

  const { error: updateError } = await admin
    .from('payroll_payouts')
    .update(patch)
    .eq('id', payout.id)
    .in('status', IN_FLIGHT)
  if (updateError) return reply({ error: updateError.message }, 500)

  console.info(`payout-result: ${payout.id} -> ${String(patch.status)}`)
  return reply(ACK)
})

/**
 * IntaSend says a payout changed. Find which one (our id rides as
 * batch_reference; the tracking id is the fallback) and ask IntaSend.
 * IntaSend retries anything but a 2xx five times over hours, so every
 * outcome past the token answers 200.
 */
async function intasendHint(body: unknown): Promise<Response> {
  const hint = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const reference = typeof hint.batch_reference === 'string' ? hint.batch_reference : ''
  const trackingId = typeof hint.tracking_id === 'string' ? hint.tracking_id.slice(0, 100) : ''
  if (!UUID.test(reference) && !trackingId) return reply({ ok: true })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const intasend = intasendConfig()
  if (!url || !serviceKey || 'error' in intasend) {
    console.error('payout-result: IntaSend callback arrived but IntaSend is not configured')
    return reply({ error: 'Not configured.' }, 500)
  }
  const admin: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: payout, error } = await admin
    .from('payroll_payouts')
    .select(
      'id, payroll_run_id, employee_id, amount_cents, msisdn, channel, bank_code, bank_account, conversation_id, status',
    )
    .eq('provider', 'intasend')
    .eq(
      UUID.test(reference) ? 'id' : 'conversation_id',
      UUID.test(reference) ? reference : trackingId,
    )
    .maybeSingle()
  if (error) return reply({ error: error.message }, 500)
  if (!payout || !INTASEND_IN_FLIGHT.includes(payout.status)) return reply({ ok: true })

  const status = await reconcileIntasendPayout(
    admin,
    intasend.config,
    payout as ClaimedPayout,
    trackingId || null,
  )
  console.info(`payout-result: intasend ${payout.id} -> ${status}`)
  return reply({ ok: true })
}
