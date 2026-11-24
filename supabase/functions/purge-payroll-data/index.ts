import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json, requireOwner } from '../_shared/owner.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const context = await requireOwner(request)
  if (context instanceof Response) return context

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !authorization) {
    return json({ error: 'Server is not configured.' }, 500)
  }

  const caller = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
  const { error } = await caller.rpc('purge_payroll_data')
  if (error) {
    console.error(`purge-payroll-data: ${error.message}`)
    return json({ error: 'Payroll data could not be removed.' }, 500)
  }

  return json({ ok: true })
})
