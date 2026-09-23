'use client'

import { DatabaseZap, FileText } from 'lucide-react'
import { useState } from 'react'
import {
  Card,
  EmptyState,
  Input,
  PageHeader,
  StatusChip,
  TabPanel,
  Table,
  Tabs,
  formatDate,
  formatKes,
  formatPhone,
  useToast,
} from '@rasko/ui'

import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { InvoiceDetailDrawer } from './InvoiceDetailDrawer.js'
import { InvoiceDocument } from './InvoiceDocument.js'
import { PaymentForm } from './PaymentForm.js'
import { ReceiptDocument } from './ReceiptDocument.js'
import { statusTone } from './status.js'
import { INVOICE_STATUS_LABEL } from './types.js'
import type { InvoiceDetail, InvoiceSummary, InvoiceView, PaymentRecord } from './types.js'
import { useCompanySettings, useInvoiceList, useInvoicesRepository } from './useInvoices.js'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  )
}

const TABS: ReadonlyArray<{ id: InvoiceView; label: string }> = [
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'draft', label: 'Drafts' },
  { id: 'all', label: 'All' },
]

export function InvoicesScreen({ role, scope }: ScreenProps) {
  const repo = useInvoicesRepository()
  const company = useCompanySettings()
  const { showToast } = useToast()

  const [view, setView] = useState<InvoiceView>('outstanding')
  const [search, setSearch] = useState('')
  const { invoices, isLoading, error, reload } = useInvoiceList({ search, view })

  const [detailId, setDetailId] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [paying, setPaying] = useState<InvoiceDetail | null>(null)
  const [printingInvoice, setPrintingInvoice] = useState<InvoiceDetail | null>(null)
  const [printingReceipt, setPrintingReceipt] = useState<{
    detail: InvoiceDetail
    payment: PaymentRecord
  } | null>(null)

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Invoices" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="Invoices are stored on the device. Run the installed application to see them."
          />
        </Card>
      </div>
    )
  }

  async function handlePayment(values: {
    amountCents: number
    method: PaymentRecord['method']
    reference: string | null
    paidAt: string
    notes: string | null
  }) {
    if (!paying) return { error: 'No invoice selected.' }
    try {
      await repo!.recordPayment({ id: newId(), invoiceId: paying.invoice.id, ...values })
      showToast({
        tone: 'success',
        title: 'Payment recorded',
        description: 'Saved on this device. It syncs when you are online.',
      })
      setRefreshToken((n) => n + 1)
      await reload()
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not record the payment.' }
    }
  }

  const isOverdueView = view === 'overdue'

  const columns = [
    {
      key: 'number',
      header: 'Invoice',
      render: (i: InvoiceSummary) => i.invoice_number ?? 'Number assigned on sync',
    },
    { key: 'client', header: 'Client', render: (i: InvoiceSummary) => i.clientName },
    ...(isOverdueView
      ? [
          {
            key: 'contact',
            header: 'Contact',
            // FR-5.8: the number to ring, right there in the follow-up list.
            render: (i: InvoiceSummary) => (i.clientPhone ? formatPhone(i.clientPhone) : '—'),
          },
          {
            key: 'age',
            header: 'Overdue',
            isNumeric: true,
            render: (i: InvoiceSummary) => `${i.daysOverdue} days`,
          },
        ]
      : [
          {
            key: 'issued',
            header: 'Issued',
            render: (i: InvoiceSummary) => formatDate(i.issue_date),
          },
          { key: 'due', header: 'Due', render: (i: InvoiceSummary) => formatDate(i.due_date) },
        ]),
    {
      key: 'status',
      header: 'Status',
      render: (i: InvoiceSummary) => (
        <StatusChip tone={statusTone(i.derivedStatus)}>
          {INVOICE_STATUS_LABEL[i.derivedStatus]}
        </StatusChip>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      isNumeric: true,
      render: (i: InvoiceSummary) => formatKes(i.total_cents),
    },
    {
      key: 'balance',
      header: 'Balance',
      isNumeric: true,
      render: (i: InvoiceSummary) => formatKes(i.balanceCents),
    },
  ]

  const empty = (
    <EmptyState
      icon={<FileText size={20} aria-hidden="true" />}
      title={
        view === 'overdue'
          ? 'Nothing overdue'
          : view === 'draft'
            ? 'No drafts'
            : search
              ? 'No invoices match'
              : 'No invoices yet'
      }
      description={
        view === 'overdue'
          ? 'Every issued invoice is either paid or still within its terms.'
          : view === 'draft'
            ? 'Drafts appear here until they are issued and take their number.'
            : 'Convert a confirmed order into an invoice from the Orders screen.'
      }
    />
  )

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Invoices"
        description="Invoices and the payments recorded against them. Balances are calculated from payments, never edited."
        meta={<ScopeBadge scope={scope} />}
      />

      <Tabs
        items={TABS.map((t) => ({ id: t.id, label: t.label }))}
        activeId={view}
        onChange={(id) => setView(id as InvoiceView)}
        aria-label="Invoice views"
      />

      <TabPanel id={view} activeId={view}>
        <div className="rsk-stack">
          <Input
            placeholder="Search by invoice number or client"
            aria-label="Search invoices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {error ? (
            <Card>
              <p style={{ color: 'var(--rasko-danger)' }}>{error}</p>
            </Card>
          ) : null}

          {isLoading ? (
            <Card>
              <p style={{ color: 'var(--rasko-text-secondary)' }}>Loading invoices.</p>
            </Card>
          ) : (
            <>
              <div className="rsk-desktop-only">
                <Card isFlush>
                  <Table
                    rows={invoices}
                    getRowKey={(i) => i.id}
                    empty={empty}
                    onRowSelect={(i) => setDetailId(i.id)}
                    columns={columns}
                  />
                </Card>
              </div>

              <div className="rsk-mobile-only rsk-stack">
                {invoices.length === 0 ? <Card>{empty}</Card> : null}
                {invoices.map((invoice) => (
                  <Card key={invoice.id}>
                    <button
                      type="button"
                      className="client-card-button"
                      onClick={() => setDetailId(invoice.id)}
                    >
                      <span className="rsk-row" style={{ justifyContent: 'space-between' }}>
                        <strong>{invoice.invoice_number ?? 'Number assigned on sync'}</strong>
                        <StatusChip tone={statusTone(invoice.derivedStatus)}>
                          {INVOICE_STATUS_LABEL[invoice.derivedStatus]}
                        </StatusChip>
                      </span>
                      <span className="client-card-line">{invoice.clientName}</span>
                      <span className="client-card-line">Due {formatDate(invoice.due_date)}</span>
                      <span className="client-card-line rsk-numeric">
                        {formatKes(invoice.balanceCents)} outstanding
                      </span>
                    </button>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </TabPanel>

      <InvoiceDetailDrawer
        invoiceId={detailId}
        repo={repo}
        role={role}
        refreshToken={refreshToken}
        onClose={() => setDetailId(null)}
        onChanged={() => {
          setRefreshToken((n) => n + 1)
          void reload()
        }}
        /*
         * Closing the drawer first is not cosmetic. The drawer is a native
         * <dialog>, which the browser renders in the top layer — above every
         * z-index, including the document overlay. Leaving it open buries the
         * document behind it.
         */
        onPrintInvoice={(detail) => {
          setDetailId(null)
          setPrintingInvoice(detail)
        }}
        onPrintReceipt={(detail, payment) => {
          setDetailId(null)
          setPrintingReceipt({ detail, payment })
        }}
        onRecordPayment={(detail) => setPaying(detail)}
      />

      {paying ? (
        <PaymentForm
          isOpen
          balanceCents={paying.invoice.balanceCents}
          onClose={() => setPaying(null)}
          onSubmit={handlePayment}
        />
      ) : null}

      {printingInvoice ? (
        <InvoiceDocument
          detail={printingInvoice}
          company={company}
          onClose={() => setPrintingInvoice(null)}
        />
      ) : null}

      {printingReceipt ? (
        <ReceiptDocument
          detail={printingReceipt.detail}
          payment={printingReceipt.payment}
          company={company}
          onClose={() => setPrintingReceipt(null)}
        />
      ) : null}
    </div>
  )
}
