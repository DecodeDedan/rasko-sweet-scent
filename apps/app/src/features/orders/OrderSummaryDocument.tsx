'use client'

import { useEffect } from 'react'
import { Button, formatDate, formatDateTime, formatMoney, formatQuantity } from '@rasko/ui'

import { ORDER_STATUS_LABEL } from './statusPipeline.js'
import type { OrderDetail } from './types.js'

/**
 * FR-4.6: a brand-styled order summary, printable and shareable.
 *
 * Rendered as an A4 print document rather than generated with a PDF library.
 * `docs/brand.md` specifies documents as "A4, print-friendly, ink on white",
 * which is exactly what the print stylesheet in `@rasko/ui` already provides,
 * and both WebView2 and WKWebView can save a print job as PDF. That keeps the
 * bundle small and the output identical to what the user sees.
 *
 * Sharing is therefore "save as PDF, then send" — a native share sheet needs a
 * Tauri plugin and is deferred with the rest of the document module.
 */
export function OrderSummaryDocument({
  detail,
  companyName,
  onClose,
}: {
  detail: OrderDetail
  companyName: string
  onClose: () => void
}) {
  // Esc closes the preview, matching every other overlay in the app.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { order, items } = detail

  return (
    <div className="doc-overlay">
      <div className="doc-toolbar rsk-no-print">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>

      <article className="doc-page">
        <header className="doc-header">
          <div>
            <p className="doc-company">{companyName}</p>
            <p className="doc-meta">Nakuru, Kenya</p>
          </div>
          <div className="doc-title-block">
            <h1 className="doc-title">Order summary</h1>
            <p className="doc-meta">{order.order_number ?? 'Number assigned on sync'}</p>
          </div>
        </header>

        <div className="doc-rule" />

        <section className="doc-parties">
          <div>
            <p className="doc-label">Client</p>
            <p className="doc-strong">{order.clientName}</p>
            {order.delivery_address ? <p className="doc-meta">{order.delivery_address}</p> : null}
          </div>
          <div>
            <p className="doc-label">Delivery</p>
            <p className="doc-strong">
              {order.delivery_at ? formatDateTime(order.delivery_at) : 'Not scheduled'}
            </p>
            <p className="doc-meta">Status: {ORDER_STATUS_LABEL[order.status]}</p>
          </div>
        </section>

        {order.order_type === 'event' ? (
          <section className="doc-event">
            <p className="doc-label">Event</p>
            <p className="doc-meta">
              {order.event_date ? formatDate(order.event_date) : '—'}
              {order.event_venue ? ` · ${order.event_venue}` : ''}
            </p>
            {order.event_setup_notes ? <p className="doc-meta">{order.event_setup_notes}</p> : null}
          </section>
        ) : null}

        <table className="doc-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="rsk-numeric">Quantity</th>
              <th className="rsk-numeric">Unit price</th>
              <th className="rsk-numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.description}</td>
                <td className="rsk-numeric">{formatQuantity(item.quantity)}</td>
                <td className="rsk-numeric">
                  {formatMoney(item.unit_price_cents, order.currency)}
                </td>
                <td className="rsk-numeric">
                  {formatMoney(item.line_total_cents, order.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Subtotal</td>
              <td className="rsk-numeric">{formatMoney(order.subtotal_cents, order.currency)}</td>
            </tr>
            {order.discount_cents > 0 ? (
              <tr>
                <td colSpan={3}>Discount</td>
                <td className="rsk-numeric">
                  -{formatMoney(order.discount_cents, order.currency)}
                </td>
              </tr>
            ) : null}
            <tr className="doc-total-row">
              <td colSpan={3}>Total</td>
              <td className="rsk-numeric">{formatMoney(order.total_cents, order.currency)}</td>
            </tr>
          </tfoot>
        </table>

        {order.notes ? (
          <section>
            <p className="doc-label">Notes</p>
            <p className="doc-meta">{order.notes}</p>
          </section>
        ) : null}

        <footer className="doc-footer">
          <p className="doc-meta">
            This is an order summary, not a tax invoice. An invoice is issued separately.
          </p>
        </footer>
      </article>
    </div>
  )
}
