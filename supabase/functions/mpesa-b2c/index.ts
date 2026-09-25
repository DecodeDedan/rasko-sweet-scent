// Sends one queued salary payout to M-Pesa B2C (migration 20260927000100).
//
// Called by the database (insert trigger and the once-a-minute sweep) with
// { id } only; verify_jwt is off. It re-reads the row with the service key and
// acts only on a row it can move from 'queued' to 'sending' in one conditional
// UPDATE, so a duplicate or forged call cannot send anything twice.
//
// WHEN MONEY MAY HAVE MOVED, STOP
// Before the payment request leaves (no credentials, token refused, network
// down), nothing has been sent: the row goes back to 'queued' or to 'failed'.
// Once the request may have reached Safaricom without a clear answer (timeout,
// 5xx), the row becomes 'unknown' and is never retried automatically, because
// retrying a payment that went through pays the employee twice. The owner
// checks the M-Pesa statement and settles it by hand.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import { DEFAULT_B2C_PATH, MPESA_BASE_URL, b2cRequestBody } from '../_shared/mpesa/b2c.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Daraja will not call a ResultURL containing words such as "mpesa" or
// "safaricom": it accepts the payment and silently never reports the result.
// So the receiving function is named without them.
const RESULT_FUNCTION = 'payout-result'
// The trailing slash matters when MPESA_CALLBACK_BASE_URL is the company
// website (https://www.raskosweetscent.com/hooks, forwarded by
// apps/website/vercel.json): the site 308-redirects any path without one, and
// Safaricom does not follow a redirect with its result.
const TOKEN_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 20_000
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface MpesaConfig {
  baseUrl: string
  b2cPath: string
  consumerKey: string
  consumerSecret: string
  shortcode: string
  initiatorName: string
  securityCredential: string
  resultUrl: string
  timeoutUrl: string
}

/** Every value from function secrets; null (and a 503) while any is missing. */
function mpesaConfig(): MpesaConfig | null {
  const get = (name: string) => Deno.env.get(name)?.trim() || null
  const env = (get('MPESA_ENV') ?? 'sandbox') as keyof typeof MPESA_BASE_URL
  const callbackBase = get('MPESA_CALLBACK_BASE_URL')?.replace(/\/+$/, '')
  const token = get('MPESA_CALLBACK_TOKEN')
  const consumerKey = get('MPESA_CONSUMER_KEY')
  const consumerSecret = get('MPESA_CONSUMER_SECRET')
  const shortcode = get('MPESA_SHORTCODE')
  const initiatorName = get('MPESA_INITIATOR_NAME')
  const securityCredential = get('MPESA_SECURITY_CREDENTIAL')
  if (!MPESA_BASE_URL[env] || !callbackBase || !token) return null
  if (!consumerKey || !consumerSecret || !shortcode || !initiatorName || !securityCredential) {
    return null
  }
  const callback = (kind: string) => `${callbackBase}/${RESULT_FUNCTION}/${kind}/${token}/`
  return {
    baseUrl: MPESA_BASE_URL[env],
    b2cPath: get('MPESA_B2C_PATH') ?? DEFAULT_B2C_PATH,
    consumerKey,
    consumerSecret,
    shortcode,
    initiatorName,
    securityCredential,
    resultUrl: callback('result'),
    timeoutUrl: callback('timeout'),
  }
}

async function accessToken(config: MpesaConfig): Promise<string> {
  const basic = btoa(`${config.consumerKey}:${config.consumerSecret}`)
  const response = await fetch(
    `${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) },
  )
  const body = (await response.json().catch(() => ({}))) as { access_token?: string }
  if (!response.ok || !body.access_token) {
    throw Object.assign(new Error(`Daraja refused the credentials (HTTP ${response.status}).`), {
      isCredentialError: response.status === 400 || response.status === 401,
    })
  }
  return body.access_token
}

async function record(admin: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from('payroll_payouts').update(patch).eq('id', id)
  if (error) console.error(`mpesa-b2c: could not record ${id}: ${error.message}`)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405)

  let id: unknown
  try {
    ;({ id } = await request.json())
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }
  if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'Malformed request.' }, 400)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const config = mpesaConfig()
  // Not configured: leave it queued and unclaimed; the sweep retries once set.
  if (!url || !serviceKey || !config) return json({ error: 'M-Pesa is not configured.' }, 503)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: payout, error: claimError } = await admin
    .from('payroll_payouts')
    .update({ status: 'sending' })
    .eq('id', id)
    .eq('status', 'queued')
    .select('id, payroll_run_id, amount_cents, msisdn, attempts')
    .maybeSingle()
  if (claimError) return json({ error: claimError.message }, 500)
  if (!payout) return json({ skipped: 'not queued' })

  await record(admin, payout.id, { attempts: payout.attempts + 1 })

  // ---- Before anything reaches Safaricom: nothing has been paid.
  let token: string
  try {
    token = await accessToken(config)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    const isCredential = (cause as { isCredentialError?: boolean })?.isCredentialError === true
    await record(admin, payout.id, {
      status: isCredential ? 'failed' : 'queued',
      result_desc: reason.slice(0, 500),
    })
    return json({ error: reason }, isCredential ? 422 : 502)
  }

  const { data: run } = await admin
    .from('payroll_runs')
    .select('period_year, period_month')
    .eq('id', payout.payroll_run_id)
    .maybeSingle()
  const period = run ? `${MONTHS[run.period_month - 1]} ${run.period_year}` : ''

  const body = b2cRequestBody(config, {
    payoutId: payout.id,
    amountShillings: Number(payout.amount_cents) / 100,
    msisdn: payout.msisdn,
    remarks: `Salary ${period}`.trim(),
    occasion: 'Rasko Sweet Scent payroll',
  })

  // ---- From here the request may reach Safaricom.
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${config.b2cPath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    await record(admin, payout.id, {
      status: 'unknown',
      result_desc:
        `No answer from M-Pesa (${reason}). Check the M-Pesa statement before paying again.`.slice(
          0,
          500,
        ),
    })
    return json({ error: reason }, 504)
  }

  const answer = (await response.json().catch(() => ({}))) as Record<string, string>
  if (response.ok && String(answer.ResponseCode) === '0') {
    await record(admin, payout.id, {
      status: 'accepted',
      conversation_id: answer.ConversationID ?? null,
      result_desc: answer.ResponseDescription ?? null,
    })
    return json({ accepted: payout.id })
  }

  // A clear refusal (4xx, or a non-zero ResponseCode) moved no money and can
  // be retried after it is fixed. A 5xx is not clear, so it is 'unknown'.
  const isRefused = response.status < 500
  const reason =
    answer.errorMessage ?? answer.ResponseDescription ?? `M-Pesa answered HTTP ${response.status}.`
  await record(admin, payout.id, {
    status: isRefused ? 'failed' : 'unknown',
    result_code: answer.errorCode ?? answer.ResponseCode ?? String(response.status),
    result_desc: (isRefused
      ? reason
      : `${reason} Check the M-Pesa statement before paying again.`
    ).slice(0, 500),
  })
  return json({ error: reason }, isRefused ? 422 : 502)
})
