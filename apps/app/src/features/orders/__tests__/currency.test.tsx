import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider, useAuth } from '../../../auth/AuthProvider.js'
import { SyncProvider } from '../../../data/sync/SyncProvider.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { createFakeGateway, makeProfile } from '../../../test/fakeGateway.js'
import { OrderDetailDrawer } from '../OrderDetailDrawer.js'
import { OrderForm } from '../OrderForm.js'
import type { OrderFormValues } from '../OrderForm.js'
import { OrderSummaryDocument } from '../OrderSummaryDocument.js'
import { OrdersRepository } from '../ordersRepository.js'
import type { ProductOption } from '../types.js'
import { ORDER, OWNER, PRODUCT_ROSE, seededDatabase } from './fixture.js'

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

describe('orders priced in another currency', () => {
  let db: SqlDatabase
  let repo: OrdersRepository

  beforeEach(async () => {
    db = await seededDatabase()
    repo = new OrdersRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER })
  })

  afterEach(async () => {
    await db.close()
  })

  it('reads a missing currency as shillings and normalises a stored code', async () => {
    await db.execute('UPDATE orders SET currency = NULL WHERE id = ?', [ORDER.confirmed])
    await db.execute("UPDATE orders SET currency = 'usd' WHERE id = ?", [ORDER.delivered])

    expect((await repo.detail(ORDER.confirmed))?.order.currency).toBe('KES')
    expect((await repo.findSummary(ORDER.delivered))?.currency).toBe('USD')
  })

  it('shows a dollar order in dollars on the detail drawer, never as shillings', async () => {
    await db.execute("UPDATE orders SET currency = 'USD' WHERE id = ?", [ORDER.confirmed])

    render(
      <Signed db={db}>
        <OrderDetailDrawer
          orderId={ORDER.confirmed}
          repo={repo}
          role="owner"
          refreshToken={0}
          onClose={() => {}}
          onChanged={() => {}}
          onPrint={() => {}}
          onDelete={() => {}}
          onInvoice={() => {}}
        />
      </Signed>,
    )

    // Order total 1,000.00; the rose line is 20 stems at 60.00, 1,200.00.
    expect(await screen.findByText('USD 1,000.00')).toBeInTheDocument()
    expect(screen.getByText('USD 60.00')).toBeInTheDocument()
    expect(screen.getByText('USD 1,200.00')).toBeInTheDocument()
    expect(screen.queryByText(/KES/)).not.toBeInTheDocument()
  })

  it('prints the order summary in the order currency', async () => {
    await db.execute("UPDATE orders SET currency = 'EUR' WHERE id = ?", [ORDER.confirmed])
    const detail = await repo.detail(ORDER.confirmed)

    render(
      <OrderSummaryDocument detail={detail!} companyName="Rasko Sweet Scent" onClose={() => {}} />,
    )

    expect(screen.getAllByText('EUR 1,000.00').length).toBeGreaterThan(0)
    expect(screen.queryByText(/KES/)).not.toBeInTheDocument()
  })
})

describe('order form currency', () => {
  const products: ProductOption[] = [
    {
      id: PRODUCT_ROSE,
      sku: 'RSS-ROS-001',
      name: 'Red Naomi Rose',
      unit: 'stem',
      selling_price_cents: 6000,
    },
  ]

  function renderForm() {
    const onSubmit = vi.fn(async (_values: OrderFormValues) => ({}))
    render(
      <OrderForm isOpen onClose={() => {}} products={products} clients={[]} onSubmit={onSubmit} />,
    )
    return onSubmit
  }

  it('fills the catalogue price for a shilling order', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Product' }), PRODUCT_ROSE)

    expect(screen.getByRole('textbox', { name: 'Unit price in KES cents' })).toHaveValue('6000')
  })

  it('does not put a shilling catalogue price into a dollar order', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'USD')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Product' }), PRODUCT_ROSE)

    const price = screen.getByRole('textbox', { name: 'Unit price in USD cents' })
    expect(price).toHaveValue('0')
    expect(screen.getByText(/Catalogue prices are in shillings/)).toBeInTheDocument()
    expect(screen.getByLabelText('Order discount in USD cents')).toBeInTheDocument()

    await user.clear(price)
    await user.type(price, '150')
    const totals = document.querySelector('.order-totals') as HTMLElement
    expect(within(totals).getAllByText('USD 1.50')).toHaveLength(2)
    expect(within(totals).queryByText(/KES/)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Walk-in sale, no client record'))
    await user.click(screen.getByRole('button', { name: 'Create order' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      currency: 'USD',
      lines: [expect.objectContaining({ productId: PRODUCT_ROSE, unitPrice: '150' })],
    })
  })

  it('keeps a typed price when the currency changes, and flags a shilling price', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Product' }), PRODUCT_ROSE)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'USD')

    expect(screen.getByRole('textbox', { name: 'Unit price in USD cents' })).toHaveValue('6000')
    expect(screen.getByText(/still hold the shilling price/)).toBeInTheDocument()
  })
})
