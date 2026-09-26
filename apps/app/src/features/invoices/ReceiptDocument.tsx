'use client'

import { useEffect } from 'react'
import { Button, formatDateTime, formatMoney } from '@rasko/ui'

import { PAYMENT_METHOD_LABEL } from './types.js'
import type { CompanySettings, InvoiceDetail, PaymentRecord } from './types.js'

/**
 * FR-5.7: a receipt for one payment.
 *
 * Deliberately scoped to a single payment rather than the invoice, because that
 * is what a client is handed when they pay. Partial payments therefore produce
 * several receipts, each showing what was paid and what remained afterwards.
 */
export function ReceiptDocument({
  detail,
  payment,
  company,
  onClose,
}: {
  detail: InvoiceDetail
  payment: PaymentRecord
  company: CompanySettings | null
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { invoice } = detail
  const net = payment.amount_cents - payment.reversedCents

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
            <p className="doc-company">{company?.company_name ?? 'Rasko Sweet Scent'}</p>
            {company?.address ? <p className="doc-meta">{company.address}</p> : null}
            {company?.kra_pin ? <p className="doc-meta">KRA PIN {company.kra_pin}</p> : null}
          </div>
          <div className="doc-title-block">
            <h1 className="doc-title">Receipt</h1>
            <p className="doc-meta">For invoice {invoice.invoice_number ?? 'not yet numbered'}</p>
            <p className="doc-meta">{formatDateTime(payment.paid_at)}</p>
          </div>
        </header>

        <div className="doc-rule" />

        <section className="doc-parties">
          <div>
            <p className="doc-label">Received from</p>
            <p className="doc-strong">{invoice.clientName}</p>
          </div>
          <div>
            <p className="doc-label">Method</p>
            <p className="doc-strong">{PAYMENT_METHOD_LABEL[payment.method]}</p>
            {payment.reference ? <p className="doc-meta">Reference {payment.reference}</p> : null}
          </div>
        </section>

        <table className="doc-table">
          <tbody>
            <tr>
              <td>Amount received</td>
              <td className="rsk-numeric">{formatMoney(payment.amount_cents, invoice.currency)}</td>
            </tr>
            {payment.reversedCents > 0 ? (
              <tr>
                <td>Reversed</td>
                <td className="rsk-numeric">
                  -{formatMoney(payment.reversedCents, invoice.currency)}
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="doc-total-row">
              <td>Net received</td>
              <td className="rsk-numeric">{formatMoney(net, invoice.currency)}</td>
            </tr>
            <tr>
              <td>Invoice total</td>
              <td className="rsk-numeric">{formatMoney(invoice.total_cents, invoice.currency)}</td>
            </tr>
            <tr>
              <td>Balance remaining</td>
              <td className="rsk-numeric">{formatMoney(invoice.balanceCents, invoice.currency)}</td>
            </tr>
          </tfoot>
        </table>

        <footer className="doc-footer">
          <p className="doc-meta">
            Thank you. Please quote the invoice number on any further payment.
          </p>
        </footer>
      </article>
    </div>
  )
}
