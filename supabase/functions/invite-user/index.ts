// FR-1.4: invite a user by email. FR-1.6: they must set their own password.
//
// Creating an auth user requires the service role key, which must exist only in
// the Supabase project's function secrets — never in the app or the repository
// (PRD §7). That is the whole reason this is an edge function rather than a
// client call.
import { corsHeaders, json, requireOwner } from '../_shared/owner.ts'

const ROLES = ['owner', 'manager', 'accountant', 'sales'] as const
type Role = (typeof ROLES)[number]

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const context = await requireOwner(request)
  if (context instanceof Response) return context
  const { admin, isSuperAdmin } = context

  let body: { email?: string; fullName?: string; role?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  const fullName = body.fullName?.trim() ?? ''
  const role = body.role as Role

  if (!email || !email.includes('@')) return json({ error: 'Enter a valid email address.' }, 400)
  if (!fullName) return json({ error: "Enter the person's full name." }, 400)
  if (!ROLES.includes(role)) return json({ error: 'Choose a valid role.' }, 400)
  if (role === 'owner' && !isSuperAdmin) {
    return json({ error: 'Only the super admin can invite an owner.' }, 403)
  }

  // The invitation email itself is delivered by the project's custom SMTP
  // sender (FR-1.5, docs/auth-setup.md), not Supabase's default sender.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: Deno.env.get('APP_PASSWORD_RESET_URL') ?? undefined,
  })

  if (inviteError || !invited.user) {
    const message = inviteError?.message ?? 'Could not send the invitation.'
    const alreadyExists = message.toLowerCase().includes('already been registered')
    return json(
      { error: alreadyExists ? 'That email already has an account.' : message },
      alreadyExists ? 409 : 500,
    )
  }

  // must_change_password defaults to true in the schema; it is set explicitly
  // here so the intent is visible at the call site (FR-1.6).
  const { error: profileError } = await admin.from('profiles').insert({
    id: invited.user.id,
    full_name: fullName,
    email,
    role,
    is_active: true,
    must_change_password: true,
  })

  if (profileError) {
    // Leaving an auth user with no profile would produce an account that can
    // sign in and then see nothing, which is worse than no account at all.
    await admin.auth.admin.deleteUser(invited.user.id)
    return json({ error: `Invitation cancelled: ${profileError.message}` }, 500)
  }

  return json({ userId: invited.user.id })
})
