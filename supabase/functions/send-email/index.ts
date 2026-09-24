// Delivers one queued row of public.outbound_emails (migration 20260925000100).
//
// Called by the database, not by the app: the insert trigger and the
// once-a-minute sweep post { id } here through pg_net. There is no user JWT to
// check (verify_jwt is off in config.toml), so the function trusts nothing in
// the request except the id. It re-reads the row with the service key and
// sends only a row it can move from 'queued' to 'sending' in one conditional
// UPDATE, which is what makes a duplicate or forged call harmless.
//
// SMTP: Brevo in production, the local Mailpit in development. Settings are
// function secrets (docs/email-setup.md); nothing is hardcoded.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

import { composeEmail } from '../_shared/email/compose.js'
import {
  detailsTable,
  formatDate,
  formatKes,
  itemsTable,
  paymentBox,
} from '../_shared/email/layout.js'

const MAX_ATTEMPTS = 5
const SMTP_TIMEOUT_MS = 15_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const METHOD_LABEL: Record<string, string> = {
  mpesa: 'M-Pesa',
  cash: 'cash',
  bank_transfer: 'bank transfer',
  cheque: 'cheque',
}

// Rows from the service client. Only the columns read here are named.
type Row = Record<string, any> // deno-lint-ignore no-explicit-any -- PostgREST rows, validated by the schema

interface OutboundEmail {
  id: string
  template_key: string
  to_email: string
  to_name: string | null
  related_id: string | null
  personal_note: string | null
  attempts: number
  created_by: string | null
}

interface Facts {
  vars: Record<string, string | number | null>
  blocksHtml: string
}

/** A problem with the record itself. Retrying cannot fix it. */
class PermanentError extends Error {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function smtpConfig() {
  const host = Deno.env.get('SMTP_HOST')
  const from = Deno.env.get('EMAIL_FROM')
  const assetBaseUrl = Deno.env.get('SITE_URL')
  if (!host || !from || !assetBaseUrl) return null
  const port = Number(Deno.env.get('SMTP_PORT') ?? '587')
  const user = Deno.env.get('SMTP_USER')
  return {
    transport: {
      host,
      port,
      secure: Deno.env.get('SMTP_SECURE') === 'true' || port === 465,
      auth: user ? { user, pass: Deno.env.get('SMTP_PASS') ?? '' } : undefined,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    },
    from,
    assetBaseUrl,
  }
}

async function one(
  query: PromiseLike<{ data: Row | null; error: { message: string } | null }>,
  what: string,
): Promise<Row> {
  const { data, error } = await query
  if (error) throw new Error(`Could not read the ${what}: ${error.message}`)
  if (data === null) throw new PermanentError(`The ${what} no longer exists.`)
  return data
}

async function linesFor(admin: SupabaseClient, orderId: string | null): Promise<Row[]> {
  if (!orderId) return []
  const { data, error } = await admin
    .from('order_items')
    .select('description, quantity, line_total_cents, position')
    .eq('order_id', orderId)
    .is('deleted_at', null)
    .order('position')
  if (error) throw new Error(`Could not read the lines: ${error.message}`)
  return data ?? []
}

async function invoiceFacts(admin: SupabaseClient, invoiceId: string) {
  const invoice = await one(
    admin.from('invoices').select('*').eq('id', invoiceId).is('deleted_at', null).maybeSingle(),
    'invoice',
  )
  if (invoice.status === 'draft' || !invoice.invoice_number) {
    throw new PermanentError('Issue the invoice before emailing it; a draft has no number yet.')
  }
  if (invoice.status === 'voided') throw new PermanentError('This invoice has been voided.')
  const status = await one(
    admin.from('invoice_status').select('*').eq('invoice_id', invoiceId).maybeSingle(),
    'invoice balance',
  )
  return { invoice, status, lines: await linesFor(admin, invoice.order_id) }
}

function daysSince(isoDate: string, now: Date): number {
  const from = new Date(`${isoDate}T00:00:00+03:00`).getTime()
  return Math.max(0, Math.floor((now.getTime() - from) / 86_400_000))
}

function lineRows(lines: Row[]) {
  return lines.map((line) => ({
    description: line.description,
    quantity: String(Number(line.quantity)),
    amount: formatKes(line.line_total_cents),
  }))
}

function invoiceBlocks(company: Row, invoice: Row, status: Row, lines: Row[]): string {
  const totals: Array<[string, string]> = [['Subtotal', formatKes(invoice.subtotal_cents)]]
  if (invoice.discount_cents > 0)
    totals.push(['Discount', `- ${formatKes(invoice.discount_cents)}`])
  if (invoice.vat_cents > 0) {
    totals.push([`VAT ${invoice.vat_rate_bp / 100}%`, formatKes(invoice.vat_cents)])
  }
  totals.push(['Total', formatKes(invoice.total_cents)])
  if (status.paid_cents > 0) totals.push(['Paid', `- ${formatKes(status.paid_cents)}`])
  totals.push(['Balance due', formatKes(status.balance_cents)])

  return (
    detailsTable([
      ['Invoice number', invoice.invoice_number],
      ['Issue date', formatDate(invoice.issue_date)],
      ['Due date', formatDate(invoice.due_date)],
    ]) +
    (lines.length ? itemsTable(lineRows(lines), totals) : '') +
    (status.balance_cents > 0 ? paymentBox(company) : '')
  )
}

async function gatherFacts(
  admin: SupabaseClient,
  email: OutboundEmail,
  company: Row,
): Promise<Facts> {
  const base = {
    company_name: company.company_name ?? 'Rasko Sweet Scent',
    client_name: email.to_name ?? 'Sir or Madam',
  }

  switch (email.template_key) {
    case 'invoice':
    case 'payment_reminder': {
      const { invoice, status, lines } = await invoiceFacts(admin, email.related_id!)
      if (email.template_key === 'payment_reminder' && status.balance_cents <= 0) {
        throw new PermanentError('This invoice is fully paid; there is nothing to remind about.')
      }
      return {
        vars: {
          ...base,
          invoice_number: invoice.invoice_number,
          due_date: formatDate(invoice.due_date),
          total: formatKes(invoice.total_cents),
          balance: formatKes(status.balance_cents),
          days_overdue: daysSince(invoice.due_date, new Date()),
        },
        blocksHtml: invoiceBlocks(company, invoice, status, lines),
      }
    }
    case 'receipt': {
      const payment = await one(
        admin.from('payments').select('*').eq('id', email.related_id!).maybeSingle(),
        'payment',
      )
      const { invoice, status } = await invoiceFacts(admin, payment.invoice_id)
      const method = METHOD_LABEL[payment.method] ?? payment.method
      return {
        vars: {
          ...base,
          amount: formatKes(payment.amount_cents),
          method,
          paid_date: formatDate(payment.paid_at),
          invoice_number: invoice.invoice_number,
          balance: formatKes(status.balance_cents),
        },
        blocksHtml: detailsTable([
          ['Amount received', formatKes(payment.amount_cents)],
          ['Method', method],
          ['Reference', payment.reference ?? ''],
          ['Date', formatDate(payment.paid_at)],
          ['Invoice', invoice.invoice_number],
          ['Balance remaining', formatKes(status.balance_cents)],
        ]),
      }
    }
    case 'order_confirmation': {
      const order = await one(
        admin
          .from('orders')
          .select('*')
          .eq('id', email.related_id!)
          .is('deleted_at', null)
          .maybeSingle(),
        'order',
      )
      if (order.status === 'cancelled') throw new PermanentError('This order has been cancelled.')
      const totals: Array<[string, string]> = []
      if (order.discount_cents > 0) {
        totals.push(
          ['Subtotal', formatKes(order.subtotal_cents)],
          ['Discount', `- ${formatKes(order.discount_cents)}`],
        )
      }
      totals.push(['Order total', formatKes(order.total_cents)])
      return {
        vars: {
          ...base,
          order_number: order.order_number,
          delivery_date: order.delivery_at
            ? formatDate(order.delivery_at)
            : 'a date we will confirm with you',
          total: formatKes(order.total_cents),
        },
        blocksHtml:
          detailsTable([
            ['Order number', order.order_number],
            ['Delivery', order.delivery_at ? formatDate(order.delivery_at) : ''],
            ['Deliver to', order.delivery_address ?? ''],
          ]) + itemsTable(lineRows(await linesFor(admin, order.id)), totals),
      }
    }
    case 'message':
      return { vars: base, blocksHtml: '' }
    default:
      throw new PermanentError(`Unknown email kind ${email.template_key}.`)
  }
}

async function record(admin: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from('outbound_emails').update(patch).eq('id', id)
  // The row stays 'sending' if this fails; the sweep returns it to the queue
  // after ten minutes. Logged so a stuck row can be explained.
  if (error) console.error(`send-email: could not record outcome for ${id}: ${error.message}`)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405)

  let id: unknown
  try {
    ;({ id } = await request.json())
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }
  if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'Malformed request.' }, 400)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const smtp = smtpConfig()
  // Not configured yet: leave the row queued and unclaimed. The sweep retries
  // every minute, so the backlog goes out once the secrets are set.
  if (!url || !serviceKey || !smtp) return json({ error: 'Email is not configured.' }, 503)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // The claim. Only one caller can move a row out of 'queued'.
  const { data: claimed, error: claimError } = await admin
    .from('outbound_emails')
    .update({ status: 'sending' })
    .eq('id', id)
    .eq('status', 'queued')
    .select('id, template_key, to_email, to_name, related_id, personal_note, attempts, created_by')
    .maybeSingle()
  if (claimError) return json({ error: claimError.message }, 500)
  if (!claimed) return json({ skipped: 'not queued' })

  const email = claimed as OutboundEmail
  const attempt = email.attempts + 1
  await record(admin, email.id, { attempts: attempt })

  try {
    const company = await one(
      admin.from('company_settings').select('*').limit(1).maybeSingle(),
      'company settings',
    )
    const template = await one(
      admin
        .from('email_templates')
        .select('subject, heading, body')
        .eq('key', email.template_key)
        .maybeSingle(),
      'email template',
    )
    const { data: sender } = email.created_by
      ? await admin.from('profiles').select('full_name').eq('id', email.created_by).maybeSingle()
      : { data: null }

    const facts = await gatherFacts(admin, email, company)
    const message = composeEmail(
      { subject: template.subject, heading: template.heading, body: template.body },
      {
        ...facts,
        personalNote: email.personal_note,
        company,
        senderName: sender?.full_name ?? null,
        assetBaseUrl: smtp.assetBaseUrl,
      },
    )

    const info = await nodemailer.createTransport(smtp.transport).sendMail({
      from: smtp.from,
      to: email.to_name ? { name: email.to_name, address: email.to_email } : email.to_email,
      replyTo: company.email ?? Deno.env.get('EMAIL_REPLY_TO') ?? undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })

    await record(admin, email.id, {
      status: 'sent',
      sent_at: new Date().toISOString(),
      last_error: null,
      provider_id: info.messageId ?? null,
    })
    return json({ sent: email.id })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    const isPermanent = cause instanceof PermanentError || attempt >= MAX_ATTEMPTS
    await record(admin, email.id, {
      // Transient (SMTP down, a timeout): back to the queue for the sweep.
      status: isPermanent ? 'failed' : 'queued',
      last_error: reason.slice(0, 500),
    })
    console.error(
      `send-email: ${email.id} attempt ${attempt} ${isPermanent ? 'failed' : 'will retry'}: ${reason}`,
    )
    return json({ error: reason }, isPermanent ? 422 : 502)
  }
})
