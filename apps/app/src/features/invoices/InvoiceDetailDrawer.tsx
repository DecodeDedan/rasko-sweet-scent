'use client'

import { Ban, BellRing, Mail, Printer, Receipt, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Drawer,
  Field,
  Input,
  StatusChip,
  Table,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPhone,
} from '@rasko/ui'

import type { Role } from '../../auth/session.js'
import { EmailActivity } from '../email/EmailActivity.js'
import { SendEmailDialog } from '../email/SendEmailDialog.js'
import type { SendEmailDialogProps } from '../email/SendEmailDialog.js'
import { useEmailHistory } from '../email/useEmail.js'
import { statusTone } from './status.js'
import { INVOICE_STATUS_LABEL, PAYMENT_METHOD_LABEL } from './types.js'
import type { InvoiceDetail, PaymentRecord } from './types.js'
import type { InvoicesRepository } from './invoicesRepository.js'

export function InvoiceDetailDrawer({
  invoiceId,
  repo,
  role,
  refreshToken,
  onClose,
  onChanged,
  onPrintInvoice,
  onPrintReceipt,
  onRecordPayment,
}: {
  invoiceId: string | null
  repo: InvoicesRepository
  role: Role
  refreshToken: number
  onClose: () => void
  onChanged: () => void
  onPrintInvoice: (detail: InvoiceDetail) => void
  onPrintReceipt: (detail: InvoiceDetail, payment: PaymentRecord) => void
  onRecordPayment: (detail: InvoiceDetail) => void
}) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reversing, setReversing] = useState<PaymentRecord | null>(null)
  const [reversalReason, setReversalReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [emailing, setEmailing] = useState<Pick<
    SendEmailDialogProps,
    'kind' | 'contextLabel' | 'related'
  > | null>(null)
  const { emails, reload: reloadEmails } = useEmailHistory(
    invoiceId ? `invoices:${invoiceId}` : null,
  )

  const isStaff = role === 'owner' || role === 'manager'

  const load = useCallback(async () => {
    if (!invoiceId) {
      setDetail(null)
      return
    }
    setDetail(await repo.detail(invoiceId))
  }, [invoiceId, repo, refreshToken])

  useEffect(() => {
    void load()
  }, [load])

  if (!invoiceId) return null
  const invoice = detail?.invoice

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
      onChanged()
      setReversing(null)
      setReversalReason('')
      setVoiding(false)
      setVoidReason('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  function newId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16),
    )
  }

  return (
    <Drawer
      isOpen={invoiceId !== null}
      onClose={onClose}
      title={invoice?.invoice_number ?? 'Invoice'}
      {...(invoice ? { description: invoice.clientName } : {})}
      footer={
        detail && invoice ? (
          <>
            <Button
              leadingIcon={<Printer size={14} aria-hidden="true" />}
              onClick={() => onPrintInvoice(detail)}
            >
              Invoice
            </Button>
            {/* A draft has no number yet (FR-5.1), so it cannot be sent. */}
            {invoice.status === 'issued' ? (
              <Button
                leadingIcon={<Mail size={14} aria-hidden="true" />}
                onClick={() =>
                  setEmailing({
                    kind: 'invoice',
                    contextLabel: `Invoice ${invoice.invoice_number ?? ''} for ${invoice.clientName}`,
                    related: { table: 'invoices', id: invoice.id },
                  })
                }
              >
                Email
              </Button>
            ) : null}
            {invoice.derivedStatus === 'overdue' ? (
              <Button
                leadingIcon={<BellRing size={14} aria-hidden="true" />}
                onClick={() =>
                  setEmailing({
                    kind: 'payment_reminder',
                    contextLabel: `Invoice ${invoice.invoice_number ?? ''}, ${invoice.daysOverdue} days overdue`,
                    related: { table: 'invoices', id: invoice.id },
                  })
                }
              >
                Remind
              </Button>
            ) : null}
            {invoice.status === 'draft' ? (
              <Button
                variant="primary"
                leadingIcon={<Send size={14} aria-hidden="true" />}
                isLoading={busy}
                onClick={() => void run(() => repo.issue(invoice.id))}
              >
                Issue invoice
              </Button>
            ) : invoice.status === 'issued' && invoice.balanceCents > 0 ? (
              <Button
                variant="primary"
                leadingIcon={<Receipt size={14} aria-hidden="true" />}
                onClick={() => onRecordPayment(detail)}
              >
                Record payment
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {!detail || !invoice ? (
        <p style={{ color: 'var(--rasko-text-secondary)' }}>Loading.</p>
      ) : (
        <div className="rsk-stack">
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="rsk-row" style={{ justifyContent: 'space-between' }}>
            <StatusChip tone={statusTone(invoice.derivedStatus)}>
              {INVOICE_STATUS_LABEL[invoice.derivedStatus]}
            </StatusChip>
            {invoice.derivedStatus === 'overdue' ? (
              <span style={{ color: 'var(--rasko-danger)', fontSize: 'var(--rasko-text-13)' }}>
                {invoice.daysOverdue} days overdue
              </span>
            ) : null}
          </div>

          {/* FR-5.1: a draft has no number, because numbering is server-assigned. */}
          {invoice.status === 'draft' ? (
            <p className="client-empty">
              This invoice is a draft. It takes its number when you issue it and it reaches the
              server, so the sequence stays gap-free across devices.
            </p>
          ) : null}

          <div className="client-figures">
            <div>
              <p className="shell__stat-label">Total</p>
              <p className="client-figure">{formatMoney(invoice.total_cents, invoice.currency)}</p>
            </div>
            <div>
              <p className="shell__stat-label">Balance</p>
              <p className="client-figure">{formatMoney(invoice.balanceCents, invoice.currency)}</p>
              <p className="shell__stat-note">
                {formatMoney(invoice.paidCents, invoice.currency)} paid
                {invoice.reversedCents > 0
                  ? `, ${formatMoney(invoice.reversedCents, invoice.currency)} reversed`
                  : ''}
              </p>
            </div>
          </div>

          <dl className="client-facts">
            <dt>Issued</dt>
            <dd>{formatDate(invoice.issue_date)}</dd>
            <dt>Due</dt>
            <dd>{formatDate(invoice.due_date)}</dd>
            {/* FR-5.8: the details needed to chase it. */}
            {detail.clientPhone ? (
              <>
                <dt>Phone</dt>
                <dd>{formatPhone(detail.clientPhone)}</dd>
              </>
            ) : null}
            {detail.clientEmail ? (
              <>
                <dt>Email</dt>
                <dd>{detail.clientEmail}</dd>
              </>
            ) : null}
            {invoice.void_reason ? (
              <>
                <dt>Voided</dt>
                <dd>{invoice.void_reason}</dd>
              </>
            ) : null}
          </dl>

          <section>
            <h3 className="client-section-title">Payments</h3>
            <Table
              rows={detail.payments}
              getRowKey={(p) => p.id}
              empty={<p className="client-empty">No payments recorded.</p>}
              columns={[
                { key: 'when', header: 'Received', render: (p) => formatDateTime(p.paid_at) },
                { key: 'method', header: 'Method', render: (p) => PAYMENT_METHOD_LABEL[p.method] },
                { key: 'ref', header: 'Reference', render: (p) => p.reference ?? '—' },
                {
                  key: 'amount',
                  header: 'Amount',
                  isNumeric: true,
                  render: (p) =>
                    p.reversedCents > 0
                      ? `${formatMoney(p.amount_cents, invoice.currency)} (${formatMoney(p.reversedCents, invoice.currency)} reversed)`
                      : formatMoney(p.amount_cents, invoice.currency),
                },
                {
                  key: 'actions',
                  header: '',
                  render: (p) => (
                    <div className="rsk-row">
                      <Button size="sm" onClick={() => onPrintReceipt(detail, p)}>
                        Receipt
                      </Button>
                      <Button
                        size="sm"
                        aria-label={`Email the receipt for ${formatMoney(p.amount_cents, invoice.currency)}`}
                        onClick={() =>
                          setEmailing({
                            kind: 'receipt',
                            contextLabel: `Receipt for ${formatMoney(p.amount_cents, invoice.currency)} on ${invoice.invoice_number ?? 'this invoice'}`,
                            related: { table: 'payments', id: p.id },
                          })
                        }
                      >
                        Email
                      </Button>
                      {/* FR-5.5: corrections are reversals, and manager/owner only. */}
                      {isStaff && p.reversedCents < p.amount_cents ? (
                        <Button size="sm" variant="danger" onClick={() => setReversing(p)}>
                          Reverse
                        </Button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
          </section>

          <EmailActivity emails={emails} />

          {reversing ? (
            <section className="rsk-stack">
              <h3 className="client-section-title">
                Reverse{' '}
                {formatMoney(reversing.amount_cents - reversing.reversedCents, invoice.currency)}
              </h3>
              <p className="client-empty">
                The payment stays on the record. A reversal is added beside it, so the history shows
                what happened rather than hiding it.
              </p>
              <Field label="Reason" isRequired>
                <Input value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} />
              </Field>
              <div className="rsk-row">
                <Button size="sm" onClick={() => setReversing(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  isLoading={busy}
                  onClick={() =>
                    void run(() =>
                      repo.reversePayment({
                        id: newId(),
                        paymentId: reversing.id,
                        amountCents: reversing.amount_cents - reversing.reversedCents,
                        reason: reversalReason,
                      }),
                    )
                  }
                >
                  Confirm reversal
                </Button>
              </div>
            </section>
          ) : null}

          {isStaff && invoice.status !== 'voided' ? (
            <section>
              {voiding ? (
                <div className="rsk-stack">
                  <Field label="Reason for voiding" isRequired>
                    <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                  </Field>
                  <p className="client-empty">
                    The invoice keeps its number. Numbers are never reused, so the sequence stays
                    gap-free.
                  </p>
                  <div className="rsk-row">
                    <Button size="sm" onClick={() => setVoiding(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      isLoading={busy}
                      onClick={() => void run(() => repo.voidInvoice(invoice.id, voidReason))}
                    >
                      Void invoice
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  leadingIcon={<Ban size={14} aria-hidden="true" />}
                  onClick={() => setVoiding(true)}
                >
                  Void invoice
                </Button>
              )}
            </section>
          ) : null}
        </div>
      )}
      {emailing && detail && invoice ? (
        <SendEmailDialog
          {...emailing}
          clientId={invoice.client_id ?? null}
          defaultToEmail={detail.clientEmail ?? null}
          defaultToName={invoice.clientName ?? null}
          onClose={() => setEmailing(null)}
          onQueued={() => void reloadEmails()}
        />
      ) : null}
    </Drawer>
  )
}
