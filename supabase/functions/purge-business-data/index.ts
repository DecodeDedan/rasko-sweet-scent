import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json, requireOwner } from '../_shared/owner.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const context = await requireOwner(request)
  if (context instanceof Response) return context
  const { isSuperAdmin } = context
  if (!isSuperAdmin) return json({ error: 'Only a super admin can purge business data.' }, 403)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !authorization) {
    return json({ error: 'Server is not configured.' }, 500)
  }

  // Use the caller's JWT for the RPC so app.is_super_admin() is evaluated as
  // the signed-in user. The function itself owns the transaction and bypasses
  // table RLS only after that check succeeds.
  const caller = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
  const { error } = await caller.rpc('purge_business_data')
  if (error) {
    console.error(`purge-business-data: ${error.message}`)
    return json({ error: 'The business data purge could not be completed. Nothing was changed.' }, 500)
  }

  return json({ ok: true })
})
