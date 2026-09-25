// FR-1.4 / T4: deactivate or reactivate a user.
//
// Deactivation is two things, and both are needed:
//
//   1. profiles.is_active = false. Every RLS policy tests it, so the user's
//      NEXT REQUEST is refused — immediately, even with a valid unexpired JWT
//      in hand. This is the part that actually revokes access.
//   2. Banning the auth user. An access token already issued stays
//      cryptographically valid until it expires (an hour by default), but a
//      banned user cannot refresh it or sign in again. This closes the window
//      rather than opening the door.
//
// Step 1 alone would let a token keep being refreshed forever. Step 2 alone
// would leave up to an hour of continued access. architecture.md §2.1.
//
// A company address (name@raskosweetscent.com) also stops forwarding while
// the person is deactivated, so client mail stops reaching someone who has
// left, and resumes on reactivation.
import { mailboxes } from '../_shared/mailbox/config.ts'
import { isCompanyAddress } from '../_shared/mailbox/routing.js'
import { corsHeaders, json, requireOwner } from '../_shared/owner.ts'

const BAN_FOREVER = '876000h' // 100 years; GoTrue has no unbounded ban.

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const context = await requireOwner(request)
  if (context instanceof Response) return context
  const { admin, ownerId, isSuperAdmin } = context

  let body: { userId?: string; isActive?: boolean }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }

  const { userId, isActive } = body
  if (typeof userId !== 'string' || typeof isActive !== 'boolean') {
    return json({ error: 'Malformed request.' }, 400)
  }

  // An owner locking themselves out would leave the business with no way back
  // in without a database administrator.
  if (userId === ownerId && !isActive) {
    return json({ error: 'You cannot deactivate your own account.' }, 400)
  }

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('is_super_admin, email')
    .eq('id', userId)
    .maybeSingle()
  if (targetError) return json({ error: 'Could not read that account.' }, 500)
  if (!target) return json({ error: 'That account no longer exists.' }, 404)
  if (target.is_super_admin && !isSuperAdmin) {
    return json({ error: 'Only the super admin can change the super admin account.' }, 403)
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      is_active: isActive,
      deactivated_at: isActive ? null : new Date().toISOString(),
    })
    .eq('id', userId)

  if (profileError) return json({ error: profileError.message }, 500)

  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: isActive ? 'none' : BAN_FOREVER,
  })

  if (banError) {
    // The profile flag already landed, so access is revoked at the data layer.
    // Report the partial result rather than claiming full success.
    return json(
      {
        error:
          'Access was revoked, but the sign-in ban could not be applied. Retry so their existing session cannot be refreshed.',
      },
      500,
    )
  }

  const mail = mailboxes()
  if (mail && isCompanyAddress(target.email, mail.domain)) {
    try {
      await mail.routing.setForwarding(String(target.email).toLowerCase(), isActive)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      return json(
        {
          error: `Access was ${isActive ? 'restored' : 'revoked'}, but their company mail forwarding could not be ${isActive ? 'resumed' : 'paused'}: ${reason} Retry.`,
        },
        502,
      )
    }
  }

  return json({ ok: true })
})
