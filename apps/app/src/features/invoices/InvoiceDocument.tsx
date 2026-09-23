'use client'

import { useEffect } from 'react'
import { Button, formatDate, formatKes } from '@rasko/ui'

import type { CompanySettings, InvoiceDetail } from './types.js'

/**
 * FR-5.2: the branded invoice.
 *
 * Company details and payment instructions come from `company_settings`, so
 * they are the business's real details and change in one place. The client and
 * company blocks fall back to the snapshots stored on the invoice — an invoice
 * reprinted years later must show what it said when it was issued (FR-5.2).
 *
 * The KRA PIN stays on the document whether or not VAT applies, so eTIMS
 * remains additive later (PRD §9).
 */
export function InvoiceDocument({
  detail,
  company,
  onClose,
}: {
  detail: InvoiceDetail
  company: CompanySettings | null
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { invoice } = detail
  const snapshot = (invoice.client_snapshot ?? {}) as Record<string, unknown>
  const clientName = String(snapshot['name'] ?? invoice.clientName)
  const hasVat = invoice.vat_cents > 0

  const paymentLines = [
    company?.mpesa_paybill ? `M-Pesa paybill ${company.mpesa_paybill}` : null,
    company?.mpesa_till ? `M-Pesa till ${company.mpesa_till}` : null,
    company?.bank_details
      ? Object.entries(company.bank_details)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join('  ·  ')
      : null,
  ].filter((line): line is string => Boolean(line))

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
            {company?.phone ? <p className="doc-meta">{company.phone}</p> : null}
            {company?.email ? <p className="doc-meta">{company.email}</p> : null}
            {company?.kra_pin ? <p className="doc-meta">KRA PIN {company.kra_pin}</p> : null}
          </div>
          <div className="doc-title-block">
            <h1 className="doc-title">
              {invoice.status === 'voided' ? 'Voided invoice' : 'Invoice'}
            </h1>
            <p className="doc-meta">{invoice.invoice_number ?? 'Number assigned on sync'}</p>
            <p className="doc-meta">Issued {formatDate(invoice.issue_date)}</p>
            <p className="doc-meta">Due {formatDate(invoice.due_date)}</p>
          </div>
        </header>

        <div className="doc-rule" />

        <section className="doc-parties">
          <div>
            <p className="doc-label">Billed to</p>
            <p className="doc-strong">{clientName}</p>
            {snapshot['address'] ? <p className="doc-meta">{String(snapshot['address'])}</p> : null}
            {snapshot['phone'] ? <p className="doc-meta">{String(snapshot['phone'])}</p> : null}
            {snapshot['kra_pin'] ? (
              <p className="doc-meta">KRA PIN {String(snapshot['kra_pin'])}</p>
            ) : null}
          </div>
          <div>
            <p className="doc-label">Balance due</p>
            <p className="doc-strong rsk-numeric" style={{ textAlign: 'left' }}>
              {formatKes(invoice.balanceCents)}
            </p>
          </div>
        </section>

        <table className="doc-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="rsk-numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{invoice.order_id ? 'Goods and services as ordered' : 'Goods and services'}</td>
              <td className="rsk-numeric">{formatKes(invoice.subtotal_cents)}</td>
            </tr>
          </tbody>
          <tfoot>
            {invoice.discount_cents > 0 ? (
              <tr>
                <td>Discount</td>
                <td className="rsk-numeric">-{formatKes(invoice.discount_cents)}</td>
              </tr>
            ) : null}
            {/* FR-9.2: the VAT line appears only when VAT applies. */}
            {hasVat ? (
              <tr>
                <td>VAT at {(invoice.vat_rate_bp / 100).toFixed(0)}%</td>
                <td className="rsk-numeric">{formatKes(invoice.vat_cents)}</td>
              </tr>
            ) : null}
            <tr className="doc-total-row">
              <td>Total</td>
              <td className="rsk-numeric">{formatKes(invoice.total_cents)}</td>
            </tr>
            {invoice.paidCents !== 0 ? (
              <>
                <tr>
                  <td>Paid</td>
                  <td className="rsk-numeric">{formatKes(invoice.paidCents)}</td>
                </tr>
                <tr className="doc-total-row">
                  <td>Balance due</td>
                  <td className="rsk-numeric">{formatKes(invoice.balanceCents)}</td>
                </tr>
              </>
            ) : null}
          </tfoot>
        </table>

        {paymentLines.length > 0 ? (
          <section>
            <p className="doc-label">How to pay</p>
            {paymentLines.map((line) => (
              <p className="doc-meta" key={line}>
                {line}
              </p>
            ))}
          </section>
        ) : (
          <section>
            <p className="doc-label">How to pay</p>
            <p className="doc-meta">
              Payment details are not set up yet. Add them in Settings so they appear here.
            </p>
          </section>
        )}

        {invoice.status === 'voided' ? (
          <section>
            <p className="doc-label">Voided</p>
            <p className="doc-meta">{invoice.void_reason}</p>
          </section>
        ) : null}
      </article>
    </div>
  )
}
