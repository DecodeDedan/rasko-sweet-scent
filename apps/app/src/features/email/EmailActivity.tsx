'use client'

import { StatusChip, formatDateTime } from '@rasko/ui'
import type { StatusTone } from '@rasko/ui'

import type { EmailKind, EmailStatus, OutboundEmail } from './emailRepository.js'

const STATUS: Record<EmailStatus, { label: string; tone: StatusTone }> = {
  queued: { label: 'Waiting to send', tone: 'neutral' },
  sending: { label: 'Sending', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Not sent', tone: 'danger' },
}

export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  order_confirmation: 'Order confirmation',
  payment_reminder: 'Payment reminder',
  message: 'Message',
}

/**
 * The delivery trail for a record: what was sent, to whom, and whether it
 * arrived. A row still waiting for its first push says so plainly, because
 * "Sent" must never be claimed before the server has actually sent it.
 */
export function EmailActivity({ emails }: { emails: readonly OutboundEmail[] }) {
  if (emails.length === 0) return null

  return (
    <section className="email-activity" aria-label="Emails sent">
      <h3 className="email-activity__title">Emails</h3>
      <ul className="email-activity__list">
        {emails.map((email) => {
          const status = STATUS[email.status] ?? STATUS.queued
          const isWaitingForSync = email.sync_status !== 'synced'
          return (
            <li key={email.id} className="email-activity__item">
              <div>
                <p className="email-activity__what">
                  {EMAIL_KIND_LABEL[email.template_key]} to {email.to_email}
                </p>
                <p className="email-activity__when">
                  {formatDateTime(email.sent_at ?? email.created_at)}
                  {email.status === 'failed' && email.last_error ? ` · ${email.last_error}` : ''}
                </p>
              </div>
              <StatusChip tone={status.tone}>
                {isWaitingForSync ? 'Waiting for sync' : status.label}
              </StatusChip>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
