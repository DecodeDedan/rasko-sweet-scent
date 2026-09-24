'use client'

import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Field, Input, Modal, Textarea, useToast } from '@rasko/ui'

import { newId } from '../../data/ids.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import type { EmailKind, EmailTemplate, RelatedTable } from './emailRepository.js'
import { useEmailRepository } from './useEmail.js'

export interface SendEmailDialogProps {
  kind: EmailKind
  /** What the email is about, shown in the dialog: "Invoice INV-2026-0004". */
  contextLabel: string
  related: { table: RelatedTable; id: string } | null
  clientId: string | null
  defaultToEmail: string | null
  defaultToName: string | null
  onClose: () => void
  onQueued?: () => void
}

/**
 * The subject as it will read: the names known here are filled in, and any
 * other detail (an invoice number the server assigns on arrival) is shown as
 * a plain word rather than a raw {{placeholder}}.
 */
function previewSubject(subject: string, clientName: string): string {
  return subject.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => {
    if (name === 'company_name') return 'Rasko Sweet Scent'
    if (name === 'client_name' && clientName.trim()) return clientName.trim()
    return name.replace(/_/g, ' ')
  })
}

const KIND_ACTION: Record<EmailKind, string> = {
  invoice: 'Email invoice',
  receipt: 'Email receipt',
  order_confirmation: 'Email order confirmation',
  payment_reminder: 'Send payment reminder',
  message: 'Email client',
}

/**
 * The composer, a centre modal: a short, focused task over the record it is
 * about. The wording comes from Settings > Emails; the sender adds a note.
 * Queuing is local and instant, so the dialog closes at once and the status
 * appears in the record's email history as sync reports it.
 */
export function SendEmailDialog({
  kind,
  contextLabel,
  related,
  clientId,
  defaultToEmail,
  defaultToName,
  onClose,
  onQueued,
}: SendEmailDialogProps) {
  const repo = useEmailRepository()
  const { phase } = useSync()
  const { showToast } = useToast()

  const [toEmail, setToEmail] = useState(defaultToEmail ?? '')
  const [toName, setToName] = useState(defaultToName ?? '')
  const [note, setNote] = useState('')
  const [template, setTemplate] = useState<EmailTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    void repo.template(kind).then((row) => {
      if (!cancelled) setTemplate(row)
    })
    return () => {
      cancelled = true
    }
  }, [repo, kind])

  const isMessage = kind === 'message'
  const isOffline = phase === 'offline' || phase === 'unavailable'

  async function send(event?: React.FormEvent) {
    event?.preventDefault()
    if (!repo) return
    setError(null)
    setIsSending(true)
    try {
      await repo.queue(newId(), {
        kind,
        toEmail,
        toName: toName || null,
        clientId,
        related,
        personalNote: note || null,
      })
      showToast({
        tone: 'success',
        title: isOffline ? 'Email saved to send' : 'Email on its way',
        description: isOffline
          ? `It goes to ${toEmail.trim()} as soon as this device is back online.`
          : `Sending to ${toEmail.trim()}. Its status shows in the email history.`,
      })
      onQueued?.()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not queue the email.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={KIND_ACTION[kind]}
      description={contextLabel}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            leadingIcon={<Mail size={15} aria-hidden="true" />}
            isLoading={isSending}
            disabled={!repo}
            onClick={() => void send()}
          >
            {isOffline ? 'Save to send' : 'Send'}
          </Button>
        </>
      }
    >
      <form className="rsk-stack" onSubmit={send} noValidate>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="email-compose__row">
          <Field label="To" isRequired>
            <Input
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="name@company.co.ke"
              autoFocus={!defaultToEmail}
            />
          </Field>
          <Field label="Name">
            <Input value={toName} onChange={(e) => setToName(e.target.value)} />
          </Field>
        </div>

        {template ? (
          <div className="email-compose__template">
            <p className="email-compose__eyebrow">Subject</p>
            <p className="email-compose__subject">{previewSubject(template.subject, toName)}</p>
            <p className="email-compose__hint">
              {isMessage
                ? 'Your message follows the greeting, inside the branded frame and signature.'
                : 'The record’s details, totals and payment instructions are added automatically, with your note below the standard wording.'}
            </p>
          </div>
        ) : null}

        <Field
          label={isMessage ? 'Message' : 'Add a note'}
          isRequired={isMessage}
          {...(isMessage ? {} : { hint: 'Optional. Appears below the standard wording.' })}
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={isMessage ? 7 : 3}
            maxLength={4000}
            autoFocus={Boolean(defaultToEmail)}
          />
        </Field>

        {isOffline ? (
          <p className="email-compose__offline" role="status">
            This device is offline. The email is kept and sent on the next sync.
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
