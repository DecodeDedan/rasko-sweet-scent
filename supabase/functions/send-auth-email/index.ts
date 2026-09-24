// Supabase Auth's Send Email Hook (config.toml [auth.hook.send_email]).
//
// Auth accepts one SMTP server and has no failover, so it does not send mail
// itself here: it hands each password reset, invitation and "password
// changed" notice to this function, which renders the branded email
// (_shared/email/auth.js) and delivers it through the same Brevo -> Resend ->
// Gmail failover the client emails use.
//
// TRUST
// Auth calls with no user JWT (verify_jwt is off for this function). The
// request is trusted only if its Standard Webhooks signature verifies against
// SEND_EMAIL_HOOK_SECRET, the secret shared with Auth. Anything else is
// refused before it is read, so the endpoint cannot be used to send mail.
//
// FAILURE
// A non-2xx answer makes Auth report the email as not sent, which the app
// shows to the person as a failed reset. Nothing is swallowed.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Webhook } from 'npm:standardwebhooks@1.0.0'

import { authEmail, authLink } from '../_shared/email/auth.js'
import { INLINE_LOGO_SRC, deliver, providers } from '../_shared/email/deliver.ts'

interface HookPayload {
  user: { email?: string }
  email_data: {
    token?: string
    token_hash?: string
    redirect_to?: string
    email_action_type?: string
    site_url?: string
  }
}

function fail(status: number, message: string): Response {
  // The shape Auth expects from a hook that refuses.
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return fail(405, 'POST only.')

  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !url || !serviceKey) return fail(500, 'The email hook is not configured.')
  if (providers().length === 0) return fail(503, 'No email provider is configured.')

  const body = await request.text()
  let payload: HookPayload
  try {
    const hook = new Webhook(secret.replace(/^v1,whsec_/, ''))
    payload = hook.verify(body, Object.fromEntries(request.headers)) as HookPayload
  } catch {
    return fail(401, 'Signature did not verify.')
  }

  const type = payload.email_data?.email_action_type ?? ''
  const to = payload.user?.email
  if (!to) return fail(400, 'The hook carried no address.')

  const tokenHash = payload.email_data.token_hash ?? ''
  const needsLink = type === 'invite' || type === 'recovery'
  if (needsLink && !tokenHash) return fail(400, 'The hook carried no token.')

  const siteUrl = Deno.env.get('SITE_URL') ?? payload.email_data.site_url ?? ''
  const link = needsLink
    ? authLink({
        redirectTo: payload.email_data.redirect_to ?? null,
        siteUrl,
        tokenHash,
        type,
      })
    : ''

  const email = authEmail(type, {
    email: to,
    link,
    code: payload.email_data.token ?? null,
    assetBaseUrl: siteUrl,
    logoSrc: INLINE_LOGO_SRC,
  })

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const sent = await deliver(
      { to, subject: email.subject, html: email.html, text: email.text },
      admin,
    )
    console.info(`send-auth-email: ${type} sent via ${sent.provider}`)
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error(`send-auth-email: ${type} not sent: ${reason}`)
    return fail(502, 'The email could not be sent. Try again in a minute.')
  }
})
