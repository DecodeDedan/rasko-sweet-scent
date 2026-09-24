'use client'

import { FileText, Mail, Printer, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Drawer,
  StatusChip,
  Table,
  formatDateTime,
  formatKes,
  formatQuantity,
} from '@rasko/ui'

import type { Role } from '../../auth/session.js'
import { EmailActivity } from '../email/EmailActivity.js'
import { SendEmailDialog } from '../email/SendEmailDialog.js'
import { useEmailHistory } from '../email/useEmail.js'
import {
  ORDER_STATUS_LABEL,
  allowedTransitions,
  canConvertToInvoice,
  canDelete,
  checkTransition,
} from './statusPipeline.js'
import type { OrderStatus } from './statusPipeline.js'
import type { OrderDetail } from './types.js'
import type { OrdersRepository } from './ordersRepository.js'

function toneFor(status: OrderStatus): 'neutral' | 'success' | 'warning' | 'muted' | 'danger' {
  if (status === 'delivered' || status === 'closed') return 'success'
  if (status === 'cancelled') return 'danger'
  if (status === 'draft') return 'muted'
  return 'neutral'
}

export function OrderDetailDrawer({
  orderId,
  repo,
  role,
  refreshToken,
  onClose,
  onChanged,
  onPrint,
  onDelete,
  onInvoice,
}: {
  orderId: string | null
  repo: OrdersRepository
  role: Role
  /**
   * Bumped by the parent after it changes the order behind this drawer — the
   * invoice conversion, for one. Without it the drawer keeps its stale copy and
   * goes on offering an action that has already happened.
   */
  refreshToken: number
  onClose: () => void
  onChanged: () => void
  onPrint: (detail: OrderDetail) => void
  onDelete: (detail: OrderDetail) => void
  onInvoice: (detail: OrderDetail) => void
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)
  const [isEmailing, setIsEmailing] = useState(false)
  const { emails, reload: reloadEmails } = useEmailHistory(orderId ? `orders:${orderId}` : null)

  const load = useCallback(async () => {
    if (!orderId) {
      setDetail(null)
      return
    }
    setDetail(await repo.detail(orderId))
    // refreshToken is a dependency on purpose: it is the parent's signal that
    // the underlying row changed.
  }, [orderId, repo, refreshToken])

  useEffect(() => {
    void load()
  }, [load])

  if (!orderId) return null
  const order = detail?.order

  async function move(to: OrderStatus, reason?: string) {
    if (!orderId) return
    setBusy(true)
    setError(null)
    try {
      await repo.transition(orderId, to, reason)
      await load()
      onChanged()
      setIsCancelling(false)
      setCancelReason('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the status.')
    } finally {
      setBusy(false)
    }
  }

  // Only the moves this role can actually make are offered; the rest would be
  // refused by the server anyway (app.guard_order_transition).
  const nextMoves = order
    ? allowedTransitions(order.status).filter(
        (to) => checkTransition(order.status, to, role).allowed,
      )
    : []

  return (
    <Drawer
      isOpen={orderId !== null}
      onClose={onClose}
      title={order?.order_number ?? 'Order'}
      {...(order ? { description: order.clientName } : {})}
      footer={
        detail && order ? (
          <>
            <Button
              leadingIcon={<Printer size={14} aria-hidden="true" />}
              onClick={() => onPrint(detail)}
            >
              Summary
            </Button>
            {/* Confirmed onwards: a draft is still being agreed with the client. */}
            {!order.is_walk_in && order.status !== 'draft' && order.status !== 'cancelled' ? (
              <Button
                leadingIcon={<Mail size={14} aria-hidden="true" />}
                onClick={() => setIsEmailing(true)}
              >
                Email
              </Button>
            ) : null}
            {canDelete(role) && order.status !== 'closed' ? (
              <Button
                variant="danger"
                leadingIcon={<Trash2 size={14} aria-hidden="true" />}
                onClick={() => onDelete(detail)}
              >
                Delete
              </Button>
            ) : null}
            {canConvertToInvoice(order.status) && !detail.invoiceId ? (
              <Button
                variant="primary"
                leadingIcon={<FileText size={14} aria-hidden="true" />}
                onClick={() => onInvoice(detail)}
              >
                Create invoice
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {!detail || !order ? (
        <p style={{ color: 'var(--rasko-text-secondary)' }}>Loading.</p>
      ) : (
        <div className="rsk-stack">
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="rsk-row" style={{ justifyContent: 'space-between' }}>
            <StatusChip tone={toneFor(order.status)}>{ORDER_STATUS_LABEL[order.status]}</StatusChip>
            <span className="rsk-numeric">{formatKes(order.total_cents)}</span>
          </div>

          <dl className="client-facts">
            <dt>Delivery</dt>
            <dd>{order.delivery_at ? formatDateTime(order.delivery_at) : 'Not scheduled'}</dd>
            <dt>Address</dt>
            <dd>{order.delivery_address ?? '—'}</dd>
            {order.order_type === 'event' ? (
              <>
                <dt>Venue</dt>
                <dd>{order.event_venue ?? '—'}</dd>
              </>
            ) : null}
            {order.cancellation_reason ? (
              <>
                <dt>Cancelled</dt>
                <dd>{order.cancellation_reason}</dd>
              </>
            ) : null}
            {detail.invoiceId ? (
              <>
                <dt>Invoice</dt>
                <dd>{detail.invoiceNumber ?? 'Draft, not yet numbered'}</dd>
              </>
            ) : null}
          </dl>

          {/* FR-4.2: the pipeline, as buttons that will actually succeed. */}
          {nextMoves.length > 0 ? (
            <section>
              <h3 className="client-section-title">Move this order on</h3>
              <div className="rsk-row" style={{ flexWrap: 'wrap' }}>
                {nextMoves
                  .filter((to) => to !== 'cancelled')
                  .map((to) => (
                    <Button
                      key={to}
                      variant="primary"
                      size="sm"
                      isLoading={busy}
                      onClick={() => void move(to)}
                    >
                      {ORDER_STATUS_LABEL[to]}
                    </Button>
                  ))}
                {nextMoves.includes('cancelled') ? (
                  <Button size="sm" variant="danger" onClick={() => setIsCancelling(true)}>
                    Cancel order
                  </Button>
                ) : null}
              </div>

              {isCancelling ? (
                <div className="rsk-stack" style={{ marginTop: 'var(--rasko-space-3)' }}>
                  <input
                    className="rsk-input"
                    aria-label="Reason for cancelling"
                    placeholder="Why is this order being cancelled"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                  <div className="rsk-row">
                    <Button size="sm" onClick={() => setIsCancelling(false)}>
                      Keep order
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      isLoading={busy}
                      onClick={() => void move('cancelled', cancelReason)}
                    >
                      Confirm cancellation
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <p className="client-empty">
              This order is {ORDER_STATUS_LABEL[order.status].toLowerCase()} and cannot be changed.
            </p>
          )}

          <section>
            <h3 className="client-section-title">Lines</h3>
            <Table
              rows={detail.items}
              getRowKey={(item) => item.id}
              empty={<p className="client-empty">No lines.</p>}
              columns={[
                { key: 'description', header: 'Item', render: (i) => i.description },
                {
                  key: 'qty',
                  header: 'Quantity',
                  isNumeric: true,
                  render: (i) => formatQuantity(i.quantity),
                },
                {
                  key: 'price',
                  header: 'Unit price',
                  isNumeric: true,
                  render: (i) => formatKes(i.unit_price_cents),
                },
                {
                  key: 'total',
                  header: 'Amount',
                  isNumeric: true,
                  render: (i) => formatKes(i.line_total_cents),
                },
              ]}
            />
          </section>

          <EmailActivity emails={emails} />
        </div>
      )}
      {isEmailing && order ? (
        <SendEmailDialog
          kind="order_confirmation"
          contextLabel={`Order ${order.order_number ?? ''} for ${order.clientName}`}
          related={{ table: 'orders', id: order.id }}
          clientId={order.client_id ?? null}
          defaultToEmail={order.clientEmail}
          defaultToName={order.clientName}
          onClose={() => setIsEmailing(false)}
          onQueued={() => void reloadEmails()}
        />
      ) : null}
    </Drawer>
  )
}
