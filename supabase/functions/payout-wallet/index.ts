// The IntaSend wallet balance, for the owner's Pay salaries dialog, so a run
// that the wallet cannot cover is caught before it is sent rather than after
// every line has failed.
//
// Owner only (requireOwner verifies the JWT and reads the role with the admin
// client). The balance needs the IntaSend secret key, which is why this is a
// function: the key never reaches a device.
//
// Advisory, never a gate the payout depends on: the app still sends when this
// is unreachable (offline-first, NFR-S1), and IntaSend refuses a payout the
// wallet cannot cover without moving any money (BF105).
import { corsHeaders, json, requireOwner } from '../_shared/owner.ts'
import { WALLETS_PATH, disbursingWallet } from '../_shared/payouts/intasend.js'
import { intasendConfig } from '../_shared/payouts/intasendClient.ts'

const TIMEOUT_MS = 10_000

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405)

  const context = await requireOwner(request)
  if (context instanceof Response) return context

  // Daraja pays from a shortcode whose balance is not readable here.
  const provider = (Deno.env.get('PAYOUT_PROVIDER')?.trim() || 'daraja').toLowerCase()
  if (provider !== 'intasend') return json({ provider })

  const intasend = intasendConfig()
  if ('error' in intasend) return json({ error: 'IntaSend is not configured.' }, 503)

  let response: Response
  try {
    response = await fetch(`${intasend.config.baseUrl}${WALLETS_PATH}`, {
      headers: { Authorization: `Bearer ${intasend.config.secretKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    console.warn(`payout-wallet: IntaSend unreachable: ${String(cause)}`)
    return json({ error: 'IntaSend did not answer. Try again in a moment.' }, 502)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    console.warn(`payout-wallet: IntaSend answered HTTP ${response.status}`)
    return json({ error: `IntaSend refused the balance request (HTTP ${response.status}).` }, 502)
  }

  const wallet = disbursingWallet(body)
  if (!wallet) return json({ error: 'IntaSend returned no KES wallet.' }, 502)
  return json({ provider, availableCents: wallet.availableCents, updatedAt: wallet.updatedAt })
})
