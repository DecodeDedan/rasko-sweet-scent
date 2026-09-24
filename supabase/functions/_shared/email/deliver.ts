// Deno glue for transport.js: real SMTP (nodemailer) and provider health kept
// in public.email_provider_health, so every function instance shares what one
// instance learned about a failing provider. Used by send-email and
// send-auth-email.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

import { LOGO_CID, LOGO_PNG_BASE64 } from './logo.js'
import { configuredProviders, memoryHealth, sendWithFailover } from './transport.js'

/** Pass as logoSrc when rendering, so the HTML points at the attached logo. */
export const INLINE_LOGO_SRC = `cid:${LOGO_CID}`

export interface OutgoingEmail {
  to: string | { name: string; address: string }
  subject: string
  html: string
  text: string
  replyTo?: string
}

export interface Delivered {
  provider: string
  messageId: string | null
}

/**
 * Health reads and writes never block delivery: if the table cannot be
 * reached, the send still goes ahead with in-process memory, because a missed
 * shortcut costs seconds and a missed email costs a customer.
 */
function databaseHealth(admin: SupabaseClient) {
  const fallback = memoryHealth()
  return {
    async unhealthyUntil(name: string): Promise<number | null> {
      const { data, error } = await admin
        .from('email_provider_health')
        .select('unhealthy_until')
        .eq('provider', name)
        .maybeSingle()
      if (error) return fallback.unhealthyUntil(name)
      return data?.unhealthy_until ? new Date(data.unhealthy_until).getTime() : null
    },
    async markUnhealthy(name: string, untilMs: number, reason: string): Promise<void> {
      await fallback.markUnhealthy(name, untilMs, reason)
      const { error } = await admin.from('email_provider_health').upsert({
        provider: name,
        unhealthy_until: new Date(untilMs).toISOString(),
        last_error: reason.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      if (error) console.error(`email: could not record ${name} as unhealthy: ${error.message}`)
    },
    async markHealthy(name: string): Promise<void> {
      await fallback.markHealthy(name)
      const { error } = await admin
        .from('email_provider_health')
        .update({ unhealthy_until: null, last_error: null, updated_at: new Date().toISOString() })
        .eq('provider', name)
        .not('unhealthy_until', 'is', null)
      if (error) console.error(`email: could not record ${name} as healthy: ${error.message}`)
    },
  }
}

/** The configured providers, for a "configured?" check before claiming work. */
export function providers() {
  return configuredProviders((name: string) => Deno.env.get(name))
}

export async function deliver(message: OutgoingEmail, admin: SupabaseClient): Promise<Delivered> {
  const withLogo = {
    ...message,
    // Inline, not a file to download: mail clients show it in place of the cid.
    attachments: [
      {
        filename: 'rss-logo.png',
        content: LOGO_PNG_BASE64,
        encoding: 'base64',
        cid: LOGO_CID,
        contentDisposition: 'inline',
      },
    ],
  }
  const result = await sendWithFailover(withLogo, {
    providers: providers(),
    createTransport: (transport: Record<string, unknown>) => nodemailer.createTransport(transport),
    health: databaseHealth(admin),
    log: (line: string) => console.warn(line),
  })
  if (result.failed.length > 0 || result.skipped.length > 0) {
    const failed = result.failed.map((f: { provider: string }) => f.provider).join(', ')
    console.warn(
      `email: sent via ${result.provider}; skipped [${result.skipped.join(', ')}], failed [${failed}]`,
    )
  }
  return { provider: result.provider, messageId: result.messageId }
}
