// Deletes a user account. Super admin only, and only once the person has been
// offboarded (deactivated), so deletion is always a second, deliberate step.
//
// What goes, and what stays (migration 20260928000100):
//   gone   the sign-in (auth user and every session), their email and phone,
//          the company address's forwarding rule
//   stays  the profile row with its id and name, marked deleted_at, so every
//          invoice, payment and audit entry still says who did it; it syncs
//          to every device, which then hides the person everywhere
//
// Each step is safe to repeat, so a failure part-way is fixed by retrying:
// the profile is scrubbed before the auth user is deleted, and a profile
// already marked deleted skips straight to finishing the rest.
import { mailboxes } from '../_shared/mailbox/config.ts'
import { isCompanyAddress } from '../_shared/mailbox/routing.js'
import { corsHeaders, json, requireOwner } from '../_shared/owner.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const context = await requireOwner(request)
  if (context instanceof Response) return context
  const { admin, ownerId, isSuperAdmin } = context
  if (!isSuperAdmin) return json({ error: 'Only the super admin can delete an account.' }, 403)

  let body: { userId?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }
  const userId = body.userId
  if (typeof userId !== 'string') return json({ error: 'Malformed request.' }, 400)
  if (userId === ownerId) return json({ error: 'You cannot delete your own account.' }, 400)

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, full_name, email, role, is_active, is_super_admin, deleted_at')
    .eq('id', userId)
    .maybeSingle()
  if (targetError) return json({ error: 'Could not read that account.' }, 500)
  if (!target) return json({ error: 'That account no longer exists.' }, 404)
  if (target.is_super_admin) return json({ error: 'The super admin cannot be deleted.' }, 403)
  if (target.is_active) {
    return json({ error: `Offboard ${target.full_name} before deleting the account.` }, 409)
  }

  if (!target.deleted_at) {
    // ---- 1. Company mail stops for good (pausing already happened at offboarding).
    const mail = mailboxes()
    if (mail && isCompanyAddress(target.email, mail.domain)) {
      try {
        await mail.routing.removeForwarding(String(target.email).toLowerCase())
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        return json(
          { error: `Nothing was deleted: the company address is still active. ${reason}` },
          502,
        )
      }
    }

    // ---- 2. The profile keeps its name and loses everything that reaches the person.
    const { error: scrubError } = await admin
      .from('profiles')
      .update({ email: null, phone: null, deleted_at: new Date().toISOString() })
      .eq('id', userId)
      .is('deleted_at', null)
    if (scrubError) return json({ error: `Nothing was deleted: ${scrubError.message}` }, 500)

    // The service role has no auth.uid(), so the audit trigger cannot name
    // who did this; the super admin is recorded explicitly. No email in it:
    // the audit log is permanent, and the point is that the address is gone.
    const { error: auditError } = await admin.from('audit_log').insert({
      actor_id: ownerId,
      actor_role: 'owner',
      action: 'profile.delete',
      entity_table: 'profiles',
      entity_id: userId,
      before: { full_name: target.full_name, role: target.role },
      after: { deleted: true },
      changed_fields: ['email', 'phone', 'deleted_at'],
    })
    if (auditError) {
      console.error(`delete-user: audit row for ${userId} not written: ${auditError.message}`)
    }
  }

  // ---- 3. The sign-in. "Not found" means an earlier attempt already did it.
  const { error: authError } = await admin.auth.admin.deleteUser(userId)
  if (authError && !/not.?found/i.test(authError.message)) {
    return json(
      {
        error: `${target.full_name} is removed from the system, but the sign-in could not be deleted: ${authError.message} Retry.`,
      },
      500,
    )
  }

  return json({ ok: true })
})
