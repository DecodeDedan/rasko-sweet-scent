// Deno / Supabase Edge Function runtime.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export interface OwnerContext {
  admin: SupabaseClient
  ownerId: string
}

/**
 * Establishes that the caller is a signed-in, active owner.
 *
 * This function holds the service key, so it must not trust anything the client
 * says about who it is. The JWT is verified against Supabase Auth, and the role
 * is then read with the ADMIN client rather than the caller's — reading it as
 * the caller would make this check depend on the profiles RLS policy staying
 * permissive, which is a coupling that would break quietly.
 *
 * Returns a Response to send back on failure, or the context on success.
 */
export async function requireOwner(request: Request): Promise<OwnerContext | Response> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Not signed in.' }, 401)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    return json({ error: 'Server is not configured.' }, 500)
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const jwt = authHeader.slice('Bearer '.length)
  const { data: userData, error: userError } = await admin.auth.getUser(jwt)
  if (userError || !userData.user) {
    return json({ error: 'Your session has expired. Sign in again.' }, 401)
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError) return json({ error: 'Could not verify your account.' }, 500)
  if (!profile?.is_active) return json({ error: 'This account has been deactivated.' }, 403)
  if (profile.role !== 'owner') {
    // FR-1.3 / FR-1.4: owner-only. The UI hides these controls, but that is not
    // what makes them owner-only — this is.
    return json({ error: 'Only the owner can manage users.' }, 403)
  }

  return { admin, ownerId: userData.user.id }
}
