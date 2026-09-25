// FR-1.4: invite a user. FR-1.6: they must set their own password.
//
// Every account signs in with a company address (name@raskosweetscent.com).
// There is no mailbox behind it: Cloudflare Email Routing forwards it to the
// person's own inbox, and the invitation goes to that inbox directly, because
// Cloudflare delivers nothing to it until its owner verifies it.
//
// Creating an auth user requires the service role key, which must exist only in
// the Supabase project's function secrets — never in the app or the repository
// (PRD §7). That is the whole reason this is an edge function rather than a
// client call.
//
// ORDER, AND WHY
//   1. forwarding rule   idempotent; a retry reuses it
//   2. auth user + link  generateLink sends nothing by itself
//   3. invitation email  if it fails, the auth user is deleted again
//   4. profile           last: profiles.id is ON DELETE RESTRICT and its
//                        insert writes an audit row, so it cannot be undone
import { authLink } from '../_shared/email/auth.js'
import { INLINE_LOGO_SRC, deliver } from '../_shared/email/deliver.ts'
import { staffInviteEmail } from '../_shared/email/staff.js'
import { MAILBOXES_NOT_CONFIGURED, isPersonalEmail, mailboxes } from '../_shared/mailbox/config.ts'
import { companyAddress } from '../_shared/mailbox/routing.js'
import { corsHeaders, json, requireOwner } from '../_shared/owner.ts'

const ROLES = ['owner', 'manager', 'accountant', 'sales'] as const
type Role = (typeof ROLES)[number]

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const context = await requireOwner(request)
  if (context instanceof Response) return context
  const { admin, isSuperAdmin } = context

  let body: { fullName?: string; role?: string; localPart?: string; personalEmail?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }

  const mail = mailboxes()
  if (!mail) return json({ error: MAILBOXES_NOT_CONFIGURED }, 503)

  const fullName = body.fullName?.trim() ?? ''
  const role = body.role as Role
  const personalEmail = body.personalEmail?.trim().toLowerCase() ?? ''
  const address = companyAddress(body.localPart ?? '', mail.domain)

  if (!fullName) return json({ error: "Enter the person's full name." }, 400)
  if (!ROLES.includes(role)) return json({ error: 'Choose a valid role.' }, 400)
  if (role === 'owner' && !isSuperAdmin) {
    return json({ error: 'Only the super admin can invite an owner.' }, 403)
  }
  if ('error' in address) return json({ error: address.error }, 400)
  if (!isPersonalEmail(personalEmail, mail.domain)) {
    return json(
      { error: 'Enter the personal email their company mail should be delivered to.' },
      400,
    )
  }

  const { data: taken, error: takenError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', address.address)
    .maybeSingle()
  if (takenError) return json({ error: 'Could not check the address.' }, 500)
  if (taken) return json({ error: `${address.address} is already in use.` }, 409)

  // ---- 1. Forwarding. Nothing here creates an account yet.
  try {
    await mail.routing.ensureDestination(personalEmail)
    await mail.routing.ensureForwardRule(address.address, personalEmail)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    const status = (cause as { status?: number } | null)?.status === 409 ? 409 : 502
    return json({ error: `The company address could not be created. ${reason}` }, status)
  }

  // ---- 2. The account and its one-time link.
  const redirectTo = Deno.env.get('APP_PASSWORD_RESET_URL') ?? undefined
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: address.address,
    options: { redirectTo },
  })
  if (linkError || !linkData.user || !linkData.properties?.hashed_token) {
    const message = linkError?.message ?? 'Could not create the account.'
    const alreadyExists = message.toLowerCase().includes('already been registered')
    return json(
      { error: alreadyExists ? `${address.address} already has an account.` : message },
      alreadyExists ? 409 : 500,
    )
  }
  const userId = linkData.user.id

  // ---- 3. The invitation, to the inbox that already works.
  const siteUrl = Deno.env.get('SITE_URL') ?? ''
  const email = staffInviteEmail({
    fullName,
    address: address.address,
    personalEmail,
    link: authLink({
      redirectTo,
      siteUrl,
      tokenHash: linkData.properties.hashed_token,
      type: 'invite',
    }),
    siteUrl,
    logoSrc: INLINE_LOGO_SRC,
  })
  try {
    await deliver(
      {
        to: { name: fullName, address: personalEmail },
        subject: email.subject,
        html: email.html,
        text: email.text,
      },
      admin,
    )
  } catch (cause) {
    await admin.auth.admin.deleteUser(userId)
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error(`invite-user: invitation to ${personalEmail} not sent: ${reason}`)
    return json({ error: 'The invitation email could not be sent. Try again in a minute.' }, 502)
  }

  // ---- 4. The profile. must_change_password defaults to true in the schema;
  // it is set explicitly so the intent is visible here (FR-1.6).
  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    full_name: fullName,
    email: address.address,
    role,
    is_active: true,
    must_change_password: true,
  })
  if (profileError) {
    // An auth user with no profile could sign in and then see nothing. The
    // link they were sent stops working with it, which is the lesser harm.
    await admin.auth.admin.deleteUser(userId)
    return json({ error: `Invitation cancelled: ${profileError.message}` }, 500)
  }

  return json({ userId, address: address.address })
})
