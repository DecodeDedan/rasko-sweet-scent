// Moves an existing account onto a company address (name@raskosweetscent.com).
//
// The account's current email becomes the inbox the new address forwards to,
// and its sign-in email becomes the company address. The password, the role
// and every record the person made stay exactly as they were; only the
// address they sign in with changes.
//
// Same rules as the Users screen (auth/userAdmin.ts): an owner may move any
// account but the super admin's, which only the super admin may move.
import { INLINE_LOGO_SRC, deliver } from '../_shared/email/deliver.ts'
import { companyEmailNotice } from '../_shared/email/staff.js'
import { MAILBOXES_NOT_CONFIGURED, isPersonalEmail, mailboxes } from '../_shared/mailbox/config.ts'
import { companyAddress } from '../_shared/mailbox/routing.js'
import { corsHeaders, json, requireOwner } from '../_shared/owner.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const context = await requireOwner(request)
  if (context instanceof Response) return context
  const { admin, isSuperAdmin } = context

  let body: { userId?: string; localPart?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }
  if (typeof body.userId !== 'string') return json({ error: 'Malformed request.' }, 400)

  const mail = mailboxes()
  if (!mail) return json({ error: MAILBOXES_NOT_CONFIGURED }, 503)

  const address = companyAddress(body.localPart ?? '', mail.domain)
  if ('error' in address) return json({ error: address.error }, 400)

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, full_name, email, is_active, is_super_admin')
    .eq('id', body.userId)
    .maybeSingle()
  if (targetError) return json({ error: 'Could not read that account.' }, 500)
  if (!target) return json({ error: 'That account no longer exists.' }, 404)
  if (target.is_super_admin && !isSuperAdmin) {
    return json({ error: 'Only the super admin can change the super admin account.' }, 403)
  }
  if (!target.is_active) return json({ error: 'Reactivate the account first.' }, 409)

  const personalEmail = String(target.email).trim().toLowerCase()
  if (!isPersonalEmail(personalEmail, mail.domain)) {
    return json({ error: `${target.full_name} already has a company email.` }, 409)
  }

  const { data: taken, error: takenError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', address.address)
    .maybeSingle()
  if (takenError) return json({ error: 'Could not check the address.' }, 500)
  if (taken) return json({ error: `${address.address} is already in use.` }, 409)

  try {
    await mail.routing.ensureDestination(personalEmail)
    await mail.routing.ensureForwardRule(address.address, personalEmail)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    const status = (cause as { status?: number } | null)?.status === 409 ? 409 : 502
    return json({ error: `The company address could not be created. ${reason}` }, status)
  }

  // email_confirm: the owner is vouching for the address, and the person
  // cannot confirm it by email until Cloudflare's verification is clicked.
  const { error: authError } = await admin.auth.admin.updateUserById(target.id, {
    email: address.address,
    email_confirm: true,
  })
  if (authError) {
    const isTaken = authError.message.toLowerCase().includes('already been registered')
    return json(
      { error: isTaken ? `${address.address} already has an account.` : authError.message },
      isTaken ? 409 : 500,
    )
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ email: address.address })
    .eq('id', target.id)
  if (profileError) {
    // Put the sign-in back, so the profile and the account never disagree
    // about who this is.
    await admin.auth.admin.updateUserById(target.id, { email: personalEmail, email_confirm: true })
    return json({ error: `Nothing was changed: ${profileError.message}` }, 500)
  }

  // The change has happened; a failed notice is reported, not rolled back.
  const siteUrl = Deno.env.get('SITE_URL') ?? ''
  const notice = companyEmailNotice({
    fullName: target.full_name,
    address: address.address,
    personalEmail,
    siteUrl,
    logoSrc: INLINE_LOGO_SRC,
  })
  let warning: string | undefined
  try {
    await deliver(
      {
        to: { name: target.full_name, address: personalEmail },
        subject: notice.subject,
        html: notice.html,
        text: notice.text,
      },
      admin,
    )
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error(`assign-company-email: notice to ${personalEmail} not sent: ${reason}`)
    warning = `${target.full_name} now signs in with ${address.address}, but the email telling them could not be sent. Tell them yourself.`
  }

  return json({ address: address.address, ...(warning ? { warning } : {}) })
})
