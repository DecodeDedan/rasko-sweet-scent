'use client'

import { Mail, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Drawer, StatusChip, Table, formatDate, formatKes, formatPhone } from '@rasko/ui'

import { EmailActivity } from '../email/EmailActivity.js'
import { SendEmailDialog } from '../email/SendEmailDialog.js'
import { useEmailHistory } from '../email/useEmail.js'
import { CLIENT_TYPE_LABEL } from './types.js'
import type { ClientDetail } from './types.js'
import type { ClientsRepository } from './clientsRepository.js'

/** FR-3.3: contact details, history, lifetime value and outstanding balance. */
export function ClientDetailDrawer({
  clientId,
  repo,
  onClose,
  onEdit,
  onDelete,
  canDelete,
}: {
  clientId: string | null
  repo: ClientsRepository
  onClose: () => void
  onEdit: (detail: ClientDetail) => void
  onDelete: (detail: ClientDetail) => void
  canDelete: boolean
}) {
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [isEmailing, setIsEmailing] = useState(false)
  const { emails, reload: reloadEmails } = useEmailHistory(clientId ? `client:${clientId}` : null)

  useEffect(() => {
    if (!clientId) {
      setDetail(null)
      return
    }
    let cancelled = false
    void repo.detail(clientId).then((result) => {
      if (!cancelled) setDetail(result)
    })
    return () => {
      cancelled = true
    }
  }, [clientId, repo])

  if (!clientId) return null

  const client = detail?.client
  const isSettled = (client?.outstandingCents ?? 0) <= 0

  /*
   * A disabled outlined button at reduced opacity barely reads as disabled, and
   * the reason was only on a hover title — which a touch device never shows.
   * State the reason in the footer instead (PRD §7: instruct, do not just stop).
   */
  const blockedReason = !canDelete
    ? 'Only a manager or the owner can delete a client.'
    : !isSettled && client
      ? `Cannot delete: ${formatKes(client.outstandingCents)} is still outstanding.`
      : null

  return (
    <Drawer
      isOpen={clientId !== null}
      onClose={onClose}
      title={client?.name ?? 'Client'}
      {...(client ? { description: CLIENT_TYPE_LABEL[client.client_type] } : {})}
      footer={
        detail ? (
          <>
            {blockedReason ? (
              <p className="client-blocked-reason">{blockedReason}</p>
            ) : (
              <Button
                variant="danger"
                leadingIcon={<Trash2 size={14} aria-hidden="true" />}
                onClick={() => onDelete(detail)}
              >
                Delete
              </Button>
            )}
            <Button
              leadingIcon={<Mail size={14} aria-hidden="true" />}
              onClick={() => setIsEmailing(true)}
            >
              Email
            </Button>
            <Button
              variant="primary"
              leadingIcon={<Pencil size={14} aria-hidden="true" />}
              onClick={() => onEdit(detail)}
            >
              Edit
            </Button>
          </>
        ) : null
      }
    >
      {!detail || !client ? (
        <p style={{ color: 'var(--rasko-text-secondary)' }}>Loading.</p>
      ) : (
        <div className="rsk-stack">
          <dl className="client-facts">
            <dt>Phone</dt>
            <dd>{client.phone ? formatPhone(client.phone) : '—'}</dd>
            <dt>Email</dt>
            <dd>{client.email ?? '—'}</dd>
            <dt>Address</dt>
            <dd>{client.address ?? '—'}</dd>
            <dt>KRA PIN</dt>
            <dd>{client.kra_pin ?? '—'}</dd>
            <dt>Credit terms</dt>
            <dd>
              {client.credit_terms_days === 0
                ? 'Due on delivery'
                : `${client.credit_terms_days} days`}
            </dd>
            {client.notes ? (
              <>
                <dt>Notes</dt>
                <dd>{client.notes}</dd>
              </>
            ) : null}
          </dl>

          <div className="client-figures">
            <div>
              <p className="shell__stat-label">Lifetime value</p>
              <p className="client-figure">{formatKes(client.lifetimeCents)}</p>
              <p className="shell__stat-note">
                {client.invoiceCount} invoice{client.invoiceCount === 1 ? '' : 's'}
              </p>
            </div>
            <div>
              <p className="shell__stat-label">Outstanding</p>
              <p className="client-figure">{formatKes(client.outstandingCents)}</p>
              <p className="shell__stat-note">
                {isSettled ? 'Nothing owed' : 'Owed on issued invoices'}
              </p>
            </div>
          </div>

          <section>
            <h3 className="client-section-title">Invoices</h3>
            <Table
              rows={detail.invoices}
              getRowKey={(row) => row.id}
              empty={<p className="client-empty">No invoices yet.</p>}
              columns={[
                {
                  key: 'number',
                  header: 'Invoice',
                  render: (row) => row.invoice_number ?? 'Not yet numbered',
                },
                {
                  key: 'issued',
                  header: 'Issued',
                  render: (row) => (row.issue_date ? formatDate(row.issue_date) : '—'),
                },
                {
                  key: 'total',
                  header: 'Total',
                  isNumeric: true,
                  render: (row) => formatKes(row.total_cents),
                },
                {
                  key: 'balance',
                  header: 'Balance',
                  isNumeric: true,
                  render: (row) => formatKes(row.balance_cents),
                },
              ]}
            />
          </section>

          <section>
            <h3 className="client-section-title">Orders</h3>
            <Table
              rows={detail.orders}
              getRowKey={(row) => row.id}
              empty={<p className="client-empty">No orders yet.</p>}
              columns={[
                { key: 'number', header: 'Order', render: (row) => row.order_number ?? '—' },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => (
                    <StatusChip tone="neutral">{row.status.replace(/_/g, ' ')}</StatusChip>
                  ),
                },
                {
                  key: 'total',
                  header: 'Total',
                  isNumeric: true,
                  render: (row) => formatKes(row.total_cents),
                },
              ]}
            />
          </section>

          <section>
            <h3 className="client-section-title">Recent payments</h3>
            <Table
              rows={detail.payments}
              getRowKey={(row) => row.id}
              empty={<p className="client-empty">No payments recorded.</p>}
              columns={[
                {
                  key: 'paid',
                  header: 'Received',
                  render: (row) => (row.paid_at ? formatDate(row.paid_at) : '—'),
                },
                { key: 'method', header: 'Method', render: (row) => row.method.replace(/_/g, ' ') },
                { key: 'ref', header: 'Reference', render: (row) => row.reference ?? '—' },
                {
                  key: 'amount',
                  header: 'Amount',
                  isNumeric: true,
                  render: (row) => formatKes(row.amount_cents),
                },
              ]}
            />
          </section>

          <EmailActivity emails={emails} />
        </div>
      )}

      {isEmailing && client ? (
        <SendEmailDialog
          kind="message"
          contextLabel={client.name}
          related={null}
          clientId={client.id}
          defaultToEmail={client.email ?? null}
          defaultToName={client.name}
          onClose={() => setIsEmailing(false)}
          onQueued={() => void reloadEmails()}
        />
      ) : null}
    </Drawer>
  )
}
