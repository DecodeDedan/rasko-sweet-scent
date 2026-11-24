// Copies the IntaSend wallet statement into public.intasend_wallet_transactions,
// so owner and accountant devices can reconcile the books against what IntaSend
// actually holds (Ledger → IntaSend).
//
// Read-only towards IntaSend: it lists the wallet and its transactions and
// never sends money. Called every 15 minutes by pg_cron and on demand from the
// app. Safe to call by anyone, any number of times: it re-reads IntaSend and
// upserts by IntaSend's own transaction id, and it skips a run that started
// less than a minute after the last one.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/owner.ts'
import {
  WALLETS_PATH,
  disbursingWallet,
  walletTransactionRows,
  walletTransactionsPath,
} from '../_shared/payouts/intasend.js'
import { intasendConfig } from '../_shared/payouts/intasendClient.ts'

const TIMEOUT_MS = 15_000
const MAX_PAGES = 20
const MIN_INTERVAL_MS = 60_000

let lastRunAt = 0

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405)

  const provider = (Deno.env.get('PAYOUT_PROVIDER')?.trim() || 'daraja').toLowerCase()
  if (provider !== 'intasend') return json({ skipped: 'Payouts are not on IntaSend.' })

  const intasend = intasendConfig()
  if ('error' in intasend) return json({ error: 'IntaSend is not configured.' }, 503)

  if (Date.now() - lastRunAt < MIN_INTERVAL_MS)
    return json({ skipped: 'Synced under a minute ago.' })
  lastRunAt = Date.now()

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Server is not configured.' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const headers = { Authorization: `Bearer ${intasend.config.secretKey}` }
  const get = async (target: string): Promise<unknown> => {
    const response = await fetch(target, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`IntaSend answered HTTP ${response.status}.`)
    return response.json()
  }

  try {
    const wallet = disbursingWallet(await get(`${intasend.config.baseUrl}${WALLETS_PATH}`))
    if (!wallet?.walletId) return json({ error: 'IntaSend returned no KES wallet.' }, 502)

    let next: string | null = `${intasend.config.baseUrl}${walletTransactionsPath(wallet.walletId)}`
    let saved = 0
    for (let page = 0; next && page < MAX_PAGES; page += 1) {
      const body = (await get(next)) as { next?: string | null }
      const rows = walletTransactionRows(body)
      if (rows.length > 0) {
        const { error } = await admin
          .from('intasend_wallet_transactions')
          .upsert(rows, { onConflict: 'transaction_id' })
        if (error) throw new Error(`Could not save IntaSend transactions: ${error.message}`)
        saved += rows.length
      }
      next = body && typeof body === 'object' && body.next ? String(body.next) : null
    }

    return json({ saved, availableCents: wallet.availableCents, updatedAt: wallet.updatedAt })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error(`intasend-sync: ${message}`)
    return json({ error: 'IntaSend could not be read. Try again in a moment.' }, 502)
  }
})
