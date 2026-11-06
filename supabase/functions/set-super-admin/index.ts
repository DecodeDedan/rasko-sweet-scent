import { corsHeaders, json, requireOwner } from '../_shared/owner.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const context = await requireOwner(request)
  if (context instanceof Response) return context
  const { admin, ownerId, isSuperAdmin } = context
  if (!isSuperAdmin) return json({ error: 'Only a super admin can grant super-admin access.' }, 403)

  let body: { userId?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }
  const userId = body.userId
  if (typeof userId !== 'string' || userId === ownerId) {
    return json({ error: 'Choose another user.' }, 400)
  }

  const { data: target, error: readError } = await admin
    .from('profiles')
    .select('id, full_name, is_active, is_super_admin')
    .eq('id', userId)
    .maybeSingle()
  if (readError) return json({ error: 'Could not read that account.' }, 500)
  if (!target) return json({ error: 'That account no longer exists.' }, 404)
  if (!target.is_active) return json({ error: 'Reactivate that account first.' }, 409)
  if (target.is_super_admin) return json({ error: 'That account is already a super admin.' }, 409)

  const { error: updateError } = await admin
    .from('profiles')
    .update({ role: 'owner', is_super_admin: true })
    .eq('id', userId)
  if (updateError) return json({ error: `Could not grant super-admin access: ${updateError.message}` }, 500)

  return json({ ok: true })
})
