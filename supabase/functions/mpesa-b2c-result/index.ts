// Receives Safaricom's asynchronous answer to a salary payout (ResultURL and
// QueueTimeOutURL of mpesa-b2c). Public by necessity: Safaricom cannot send a
// Supabase JWT, so verify_jwt is off.
//
// TRUST
//   * the URL carries MPESA_CALLBACK_TOKEN, a long random secret known only to
//     this project and to the ResultURL we gave Safaricom; a request without
//     it is refused before its body is read;
//   * only a payout that is actually in flight ('sending', 'accepted',
//     'unknown') can be settled, and only by its own id, so a replayed or
//     forged callback cannot touch a finished payout;
//   * an answer that does not add up (a queue timeout, or a paid amount that
//     differs from what was sent) is set to 'unknown' for a person to check,
//     never guessed into 'paid' or 'failed'.
//
// Safaricom retries a callback it thinks failed, so this always answers 200
// once the token checks out, even for an id it does not recognise.
import { createClient } from 'jsr:@supabase/supabase-js@2'

import { parseResult } from '../_shared/mpesa/b2c.js'

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
  const params = new URL(request.url).searchParams
  if (!expected || !sameSecret(params.get('token') ?? '', expected)) {
    return reply({ error: 'Forbidden.' }, 403)
  }
  const isTimeout = params.get('kind') === 'timeout'

  const body = await request.json().catch(() => null)
  const result = parseResult(body)
  if (!result || !UUID.test(result.originatorId)) {
    console.warn('mpesa-b2c-result: ignored a body that is not a result for one of our payouts')
    return reply(ACK)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return reply({ error: 'Not configured.' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: payout, error } = await admin
    .from('payroll_payouts')
    .select('id, status, amount_cents')
    .eq('id', result.originatorId)
    .maybeSingle()
  if (error) return reply({ error: error.message }, 500)
  if (!payout || !IN_FLIGHT.includes(payout.status)) {
    console.warn(`mpesa-b2c-result: ${result.originatorId} is not in flight; ignored`)
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

  console.info(`mpesa-b2c-result: ${payout.id} -> ${String(patch.status)}`)
  return reply(ACK)
})
