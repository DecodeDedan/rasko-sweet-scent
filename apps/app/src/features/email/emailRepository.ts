import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'

/**
 * Client email (migration 20260925000100). Sending is a local insert: the row
 * syncs up, the server delivers it, and its status syncs back. Nothing here
 * touches the network, so an email composed with no signal is kept and goes
 * out on the next sync, like every other write (NFR-S1).
 */

export type EmailKind =
  'invoice' | 'receipt' | 'order_confirmation' | 'payment_reminder' | 'message'

export type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed'

export type RelatedTable = 'invoices' | 'payments' | 'orders'

export interface EmailDraft {
  kind: EmailKind
  toEmail: string
  toName: string | null
  clientId: string | null
  related: { table: RelatedTable; id: string } | null
  personalNote: string | null
}

export interface OutboundEmail {
  id: string
  template_key: EmailKind
  to_email: string
  to_name: string | null
  related_table: RelatedTable | null
  related_id: string | null
  personal_note: string | null
  status: EmailStatus
  attempts: number
  last_error: string | null
  sent_at: string | null
  created_at: string
  sync_status: string
}

export interface EmailTemplate {
  id: string
  key: EmailKind
  label: string
  subject: string
  heading: string
  body: string
}

/** The placeholders each kind can use, shown beside the editor in Settings. */
export const TEMPLATE_PLACEHOLDERS: Record<EmailKind, readonly string[]> = {
  invoice: ['client_name', 'company_name', 'invoice_number', 'due_date', 'total', 'balance'],
  receipt: [
    'client_name',
    'company_name',
    'amount',
    'method',
    'paid_date',
    'invoice_number',
    'balance',
  ],
  order_confirmation: ['client_name', 'company_name', 'order_number', 'delivery_date', 'total'],
  payment_reminder: [
    'client_name',
    'company_name',
    'invoice_number',
    'due_date',
    'balance',
    'days_overdue',
  ],
  message: ['client_name', 'company_name'],
}

/** Mirrors the outbound_emails CHECK constraints so a bad row fails here, not after sync. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NOTE_LENGTH = 4000

export class EmailRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailRuleError'
  }
}

export class EmailRepository {
  private readonly emails: Repository<Record<string, unknown>>
  private readonly templateRows: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly role: Role,
    context: WriteContext,
  ) {
    this.emails = new Repository(db, 'outbound_emails', context)
    this.templateRows = new Repository(db, 'email_templates', context)
  }

  async queue(id: string, draft: EmailDraft): Promise<void> {
    const toEmail = draft.toEmail.trim()
    if (!EMAIL_PATTERN.test(toEmail)) throw new EmailRuleError('Enter a valid email address.')
    const note = draft.personalNote?.trim() || null
    if (note && note.length > MAX_NOTE_LENGTH) {
      throw new EmailRuleError(`Keep the note under ${MAX_NOTE_LENGTH} characters.`)
    }
    if (draft.kind === 'message' && !note) {
      throw new EmailRuleError('Write the message you want to send.')
    }
    if (draft.kind !== 'message' && !draft.related) {
      throw new EmailRuleError('This email needs the record it is about.')
    }

    // Status, attempts and the server clock are set by the server
    // (app.force_outbound_email_defaults); these values only fill the local
    // row until the real one syncs back.
    await this.emails.insert({
      id,
      template_key: draft.kind,
      to_email: toEmail,
      to_name: draft.toName?.trim() || null,
      client_id: draft.clientId,
      related_table: draft.related?.table ?? null,
      related_id: draft.related?.id ?? null,
      personal_note: note,
      status: 'queued',
      attempts: 0,
      last_error: null,
      sent_at: null,
    })
  }

  /**
   * Emails about one record, newest first. An invoice's history includes the
   * receipts for its payments, which is where a client's paperwork lives.
   */
  async historyFor(table: RelatedTable, relatedId: string): Promise<OutboundEmail[]> {
    return this.db.select<OutboundEmail>(
      `SELECT * FROM outbound_emails
        WHERE deleted_at IS NULL
          AND ((related_table = ? AND related_id = ?)
               OR (? = 'invoices' AND related_table = 'payments'
                   AND related_id IN (SELECT id FROM payments WHERE invoice_id = ?)))
        ORDER BY created_at DESC LIMIT 20`,
      [table, relatedId, table, relatedId],
    )
  }

  /** Emails to one client, newest first, general messages included. */
  async historyForClient(clientId: string): Promise<OutboundEmail[]> {
    return this.db.select<OutboundEmail>(
      `SELECT * FROM outbound_emails
        WHERE client_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 20`,
      [clientId],
    )
  }

  async recent(limit = 100): Promise<OutboundEmail[]> {
    return this.db.select<OutboundEmail>(
      `SELECT * FROM outbound_emails WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
      [limit],
    )
  }

  async templates(): Promise<EmailTemplate[]> {
    return this.db.select<EmailTemplate>(
      `SELECT id, key, label, subject, heading, body FROM email_templates
        WHERE deleted_at IS NULL ORDER BY label`,
    )
  }

  async template(kind: EmailKind): Promise<EmailTemplate | null> {
    const rows = await this.db.select<EmailTemplate>(
      `SELECT id, key, label, subject, heading, body FROM email_templates
        WHERE key = ? AND deleted_at IS NULL LIMIT 1`,
      [kind],
    )
    return rows[0] ?? null
  }

  /** Owner and manager only, as the email_templates_update policy says. */
  async updateTemplate(
    id: string,
    patch: Pick<EmailTemplate, 'subject' | 'heading' | 'body'>,
  ): Promise<void> {
    if (this.role !== 'owner' && this.role !== 'manager') {
      throw new EmailRuleError('Only a manager or the owner can change email wording.')
    }
    const subject = patch.subject.trim()
    const heading = patch.heading.trim()
    const body = patch.body.trim()
    if (!subject || !heading || !body) {
      throw new EmailRuleError('Subject, heading and message all need some text.')
    }
    await this.templateRows.update(id, { subject, heading, body })
  }
}
