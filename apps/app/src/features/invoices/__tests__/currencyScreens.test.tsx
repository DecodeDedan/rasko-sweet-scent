import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthProvider, useAuth } from '../../../auth/AuthProvider.js'
import { SyncProvider } from '../../../data/sync/SyncProvider.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { createFakeGateway, makeProfile } from '../../../test/fakeGateway.js'
import { InvoiceDetailDrawer } from '../InvoiceDetailDrawer.js'
import { PaymentForm } from '../PaymentForm.js'
import { ReceiptDocument } from '../ReceiptDocument.js'
import { InvoicesRepository } from '../invoicesRepository.js'
import { INVOICE, OWNER, TODAY, seededDatabase } from './fixture.js'

const PAYMENT = '90000000-0000-4000-8000-0000000000c1'

/** The drawer reads email history, which needs a signed-in identity and a database. */
function Signed({ db, children }: { db: SqlDatabase; children: ReactNode }) {
  const gateway = createFakeGateway({
    sessionUserId: OWNER,
    profiles: [makeProfile({ id: OWNER, role: 'owner', fullName: 'Test owner' })],
  })
  function WhenSignedIn() {
    const { status } = useAuth()
    return status === 'signed-in' ? <>{children}</> : <p>Loading identity</p>
  }
  return (
    <AuthProvider gateway={gateway}>
      <SyncProvider db={db} remote={null}>
        <WhenSignedIn />
      </SyncProvider>
    </AuthProvider>
  )
}

describe('an invoice in dollars', () => {
  let db: SqlDatabase
  let repo: InvoicesRepository

  beforeEach(async () => {
    db = await seededDatabase()
    repo = new InvoicesRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER }, TODAY)
    await db.execute("UPDATE invoices SET currency = 'USD', total_cents = 108000 WHERE id = ?", [
      INVOICE.unpaid,
    ])
    await repo.recordPayment({
      id: PAYMENT,
      invoiceId: INVOICE.unpaid,
      amountCents: 40000,
      method: 'bank_transfer',
      reference: 'TT-0042',
      paidAt: '2026-09-02T10:00:00.000Z',
      notes: null,
    })
  })

  afterEach(async () => {
    await db.close()
  })

  it('shows the total, balance and payment in dollars on the detail drawer', async () => {
    render(
      <Signed db={db}>
        <InvoiceDetailDrawer
          invoiceId={INVOICE.unpaid}
          repo={repo}
          role="owner"
          refreshToken={0}
          onClose={() => {}}
          onChanged={() => {}}
          onPrintInvoice={() => {}}
          onPrintReceipt={() => {}}
          onRecordPayment={() => {}}
        />
      </Signed>,
    )

    expect(await screen.findByText('USD 1,080.00')).toBeInTheDocument()
    expect(screen.getByText('USD 680.00')).toBeInTheDocument()
    expect(screen.getByText(/USD 400\.00 paid/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email the receipt for USD 400.00' })).toBeVisible()
    expect(screen.queryByText(/KES/)).not.toBeInTheDocument()
  })

  it('writes a dollar payment receipt in dollars', async () => {
    const detail = await repo.detail(INVOICE.unpaid)
    const payment = detail!.payments.find((p) => p.id === PAYMENT)!

    render(<ReceiptDocument detail={detail!} payment={payment} company={null} onClose={() => {}} />)

    expect(screen.getAllByText('USD 400.00')).toHaveLength(2) // received, and net received
    expect(screen.getByText('USD 1,080.00')).toBeInTheDocument()
    expect(screen.getByText('USD 680.00')).toBeInTheDocument()
    expect(screen.queryByText(/KES/)).not.toBeInTheDocument()
  })

  it('asks for the payment in the invoice currency', () => {
    render(
      <PaymentForm
        isOpen
        onClose={() => {}}
        balanceCents={68000}
        currency="USD"
        onSubmit={async () => ({})}
      />,
    )

    expect(screen.getByText('Balance outstanding: USD 680.00')).toBeInTheDocument()
    expect(screen.getByLabelText(/Amount in USD/)).toHaveValue('680.00')
  })
})
