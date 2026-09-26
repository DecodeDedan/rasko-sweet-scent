'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Mail, MapPin, Phone } from 'lucide-react'
import { Button, formatDate, formatQuantity } from '@rasko/ui'

import { BrandMark } from '../../shell/BrandMark.js'
import { InvoiceStamp } from './InvoiceStamp.js'
import { currencySymbol, ledgerHeading } from './currency.js'
import type { CompanySettings, InvoiceDetail, InvoiceLine } from './types.js'
import './invoice.css'

/**
 * FR-5.2: the invoice, set as the company's own paper invoice book — the same
 * letterhead, fields, ledger columns, footer and faces (invoice.css) — so a
 * printed copy is the document the trade customers already know. Everything a
 * person keys in (date, order and delivery numbers, customer, particulars,
 * figures) is set in a blue ballpoint hand, as it is written in the book.
 *
 * Company details come from `company_settings`; the customer falls back to the
 * snapshot stored on the invoice, because a reprint must show what the invoice
 * said when it was issued. The KRA PIN is printed whether or not VAT applies,
 * so eTIMS stays additive (PRD §9).
 *
 * Issued invoices carry the company stamp (InvoiceStamp.tsx) with the real
 * signature, dated with the invoice's own issue date.
 */

/** The book is ruled to this many rows, so a short invoice still looks like one. */
const MIN_LEDGER_ROWS = 16

const LETTERHEAD = {
  slogan: 'All that Nature Gives',
  lineOfBusiness: 'Line of business: Floricultural & Horticultural products & services.',
} as const

const wholeUnits = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 })

/** Splits minor units into the book's two money columns. */
export function splitAmount(cents: number): { units: string; cents: string } {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  const sign = safe < 0 ? '-' : ''
  const abs = Math.abs(safe)
  return {
    units: sign + wholeUnits.format(Math.floor(abs / 100)),
    cents: String(abs % 100).padStart(2, '0'),
  }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** "2026-08-23" -> "23 AUG 2026", read as a calendar date so no timezone moves it. */
export function stampDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
  if (!match) return ''
  const [, year, month, day] = match
  return `${day} ${MONTHS[Number(month) - 1] ?? ''} ${year}`
}

/** "+254700339635" -> "0700 339 635", as the letterhead prints its numbers. */
export function localPhone(phone: string): string {
  const match = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(phone)
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : phone
}

/** A rate as it is written in the book: "18" for whole units, "0.18" otherwise. */
export function writtenRate(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

/** Written in, not printed: the blue ballpoint face. */
function Hand({ children }: { children: ReactNode }) {
  return <span className="inv-hand">{children}</span>
}

function Disc({ children }: { children: ReactNode }) {
  return (
    <span className="inv-disc" aria-hidden="true">
      {children}
    </span>
  )
}

/** The letterhead's WhatsApp mark: a speech bubble round a handset. */
function WhatsAppMark() {
  return (
    <svg className="inv-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 1.5a10.5 10.5 0 0 0-9.1 15.7L1.5 22.5l5.5-1.4A10.5 10.5 0 1 0 12 1.5z"
        fill="currentColor"
      />
      <Phone x={6.2} y={6.2} width={11.6} height={11.6} color="#fff" strokeWidth={2.6} />
    </svg>
  )
}

function MoneyCells({ cents, prefix }: { cents: number; prefix?: string | undefined }) {
  const { units, cents: minor } = splitAmount(cents)
  return (
    <>
      <td className="inv-num">
        <Hand>
          {prefix ? `${prefix} ` : ''}
          {units}
        </Hand>
      </td>
      <td className="inv-num">
        <Hand>{minor}</Hand>
      </td>
    </>
  )
}

function LedgerRow({ line }: { line: InvoiceLine }) {
  return (
    <tr>
      <td className="inv-center">
        <Hand>{formatQuantity(line.quantity)}</Hand>
      </td>
      <td>
        <Hand>
          {line.description}
          {line.discountCents > 0
            ? ` less ${splitAmount(line.discountCents).units}.${splitAmount(line.discountCents).cents}`
            : ''}
        </Hand>
      </td>
      <td className="inv-center">
        <Hand>{writtenRate(line.unitPriceCents)}</Hand>
      </td>
      <MoneyCells cents={line.lineTotalCents} />
    </tr>
  )
}

/** Discount and VAT are written into the ledger, as the book's writer would. */
function WrittenRow({ label, cents }: { label: string; cents: number }) {
  return (
    <tr>
      <td />
      <td>
        <Hand>{label}</Hand>
      </td>
      <td />
      <MoneyCells cents={cents} />
    </tr>
  )
}

function Blank() {
  return <span className="inv-blankline" />
}

export interface InvoiceDocumentProps {
  detail: InvoiceDetail
  company: CompanySettings | null
  onClose: () => void
}

export function InvoiceDocument({ detail, company, onClose }: InvoiceDocumentProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { invoice, lines } = detail
  const snapshot = (invoice.client_snapshot ?? {}) as Record<string, unknown>
  const clientName = String(snapshot['name'] ?? invoice.clientName)
  const clientPin = snapshot['kra_pin'] ? String(snapshot['kra_pin']) : null
  const currency = invoice.currency
  // The printed "Ksh" heading covers shillings; any other currency is written in.
  const totalPrefix = currency === 'KES' ? undefined : currencySymbol(currency)
  // A stamp vouches for an issued document; a draft or a void carries none.
  const isStamped = invoice.status === 'issued'
  const bank = company?.bank_details ?? null
  const bankName = bank?.['Bank'] == null ? null : String(bank['Bank'])
  const bankAccount = bank?.['Account'] == null ? null : String(bank['Account'])

  const printed: InvoiceLine[] =
    lines.length > 0
      ? lines
      : [
          {
            description: invoice.order_id ? 'Goods and services as ordered' : 'Goods and services',
            quantity: 1,
            unitPriceCents: invoice.subtotal_cents,
            discountCents: 0,
            lineTotalCents: invoice.subtotal_cents,
          },
        ]
  const written = (invoice.discount_cents > 0 ? 1 : 0) + (invoice.vat_cents > 0 ? 1 : 0)
  const blankRows = Math.max(0, MIN_LEDGER_ROWS - printed.length - written)

  return (
    <div className="doc-overlay">
      <div className="doc-toolbar rsk-no-print">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>

      <article className="doc-page inv">
        <header className="inv-head">
          <BrandMark height={96} className="inv-mark" />
          <p className="inv-kind">INVOICE</p>
          <h1 className="inv-name">RASKO SWEET SCENT</h1>
          <p className="inv-slogan">{LETTERHEAD.slogan}</p>
          <p className="inv-business">{LETTERHEAD.lineOfBusiness}</p>
        </header>

        <section className="inv-details">
          <div className="inv-contact">
            {company?.kra_pin ? <p className="inv-pin">KRA PIN {company.kra_pin}</p> : null}
            {company?.address ? (
              <p className="inv-condensed">
                <Disc>
                  <MapPin strokeWidth={2.6} />
                </Disc>
                {company.address.toUpperCase()}
              </p>
            ) : null}
            {company?.email ? (
              <p className="inv-email">
                <Disc>
                  <Mail strokeWidth={2.6} />
                </Disc>
                Email:{company.email}
              </p>
            ) : null}
            {company?.phone || company?.whatsapp ? (
              <p className="inv-condensed inv-phones">
                {company.phone ? (
                  <span>
                    <Phone className="inv-icon" strokeWidth={2.4} aria-hidden="true" />
                    {localPhone(company.phone)}
                  </span>
                ) : null}
                {company.whatsapp ? (
                  <span>
                    <WhatsAppMark />
                    {localPhone(company.whatsapp)}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          <div className="inv-fields">
            <p>
              <span>Date</span>
              <span className="inv-fill">
                <Hand>{formatDate(invoice.issue_date)}</Hand>
              </span>
            </p>
            <p>
              <span>Order No.</span>
              <span className="inv-fill">
                <Hand>{detail.orderNumber ?? ''}</Hand>
              </span>
            </p>
            <p>
              <span>Delivery No</span>
              <span className="inv-fill">
                <Hand>{detail.deliveryNumber ?? ''}</Hand>
              </span>
            </p>
          </div>
        </section>

        <p className="inv-ms">
          <span>M/S</span>
          <span className="inv-fill">
            <Hand>
              {clientName}
              {clientPin ? `, PIN ${clientPin}` : ''}
            </Hand>
          </span>
        </p>

        <div className="inv-frame">
          <BrandMark height={330} className="inv-watermark" />
          <table className="inv-ledger">
            <colgroup>
              <col style={{ width: '13%' }} />
              <col />
              <col style={{ width: '10%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">QTY</th>
                <th scope="col">PARTICULARS</th>
                <th scope="col">@</th>
                <th scope="col">{ledgerHeading(currency)}</th>
                <th scope="col">Cts</th>
              </tr>
            </thead>
            <tbody>
              {printed.map((line, index) => (
                <LedgerRow key={index} line={line} />
              ))}
              {invoice.discount_cents > 0 ? (
                <WrittenRow label="Less discount" cents={-invoice.discount_cents} />
              ) : null}
              {/* FR-9.2: the VAT line appears only when VAT applies. */}
              {invoice.vat_cents > 0 ? (
                <WrittenRow
                  label={`VAT at ${(invoice.vat_rate_bp / 100).toFixed(0)}%`}
                  cents={invoice.vat_cents}
                />
              ) : null}
              {Array.from({ length: blankRows }, (_, index) => (
                <tr key={`blank-${index}`} className="inv-empty" aria-hidden="true">
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="inv-center">E&amp;O.E</td>
                <td colSpan={2}>
                  <span className="inv-total-row">
                    <span>
                      No.{' '}
                      <span className="inv-no">{invoice.invoice_number ?? 'Assigned on sync'}</span>
                    </span>
                    <strong>TOTAL</strong>
                  </span>
                </td>
                <MoneyCells cents={invoice.total_cents} prefix={totalPrefix} />
              </tr>
            </tfoot>
          </table>

          {isStamped ? (
            <div className="inv-stamp">
              <InvoiceStamp date={stampDate(invoice.issue_date)} email={company?.email ?? null} />
            </div>
          ) : null}
        </div>

        <footer className="inv-foot">
          <p>
            <span>Received By</span>
            <Blank />
            <span className="inv-demand">Accounts are due on demand.</span>
          </p>
          <p>
            <span>Bank:</span>
            {bankName ? <Hand>{bankName}</Hand> : null}
            <Blank />
            <span>A/c Name:</span>
            {bankName ? <Hand>{company?.company_name}</Hand> : null}
            <Blank />
          </p>
          <p>
            <span>A/c Number:</span>
            {bankAccount ? <Hand>{bankAccount}</Hand> : null}
            <Blank />
            <span>your reference:</span>
            <Blank />
          </p>
          {company?.mpesa_paybill || company?.mpesa_till ? (
            <p>
              <Hand>
                {[
                  company.mpesa_paybill ? `M-Pesa paybill ${company.mpesa_paybill}` : null,
                  company.mpesa_till ? `M-Pesa till ${company.mpesa_till}` : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </Hand>
            </p>
          ) : null}
          {invoice.status === 'voided' ? (
            <p className="inv-void">
              Voided{invoice.void_reason ? `: ${invoice.void_reason}` : ''}
            </p>
          ) : null}
        </footer>
      </article>
    </div>
  )
}
