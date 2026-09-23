import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { pendingCount } from '../../../data/sync/outbox.js'
import { OrderRuleError, OrdersRepository } from '../ordersRepository.js'
import {
  CLIENT,
  MANAGER,
  ORDER,
  OWNER,
  PRODUCT_GYP,
  PRODUCT_ROSE,
  SALES,
  seededDatabase,
} from './fixture.js'

describe('orders repository', () => {
  let db: SqlDatabase
  let asOwner: OrdersRepository
  let asManager: OrdersRepository
  let asSales: OrdersRepository

  beforeEach(async () => {
    db = await seededDatabase()
    asOwner = new OrdersRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER })
    asManager = new OrdersRepository(db, { role: 'manager', userId: MANAGER }, { userId: MANAGER })
    asSales = new OrdersRepository(db, { role: 'sales', userId: SALES }, { userId: SALES })
  })

  afterEach(async () => {
    await db.close()
  })

  // ------------------------------------------------- FR-4.2 status transitions

  it('moves an order forward one step at a time', async () => {
    await asOwner.transition(ORDER.confirmed, 'in_production')
    expect((await asOwner.findSummary(ORDER.confirmed))?.status).toBe('in_production')

    await asOwner.transition(ORDER.confirmed, 'ready')
    expect((await asOwner.findSummary(ORDER.confirmed))?.status).toBe('ready')
  })

  it('refuses to skip a step', async () => {
    await expect(asOwner.transition(ORDER.confirmed, 'delivered')).rejects.toThrow(
      /cannot go from confirmed to delivered/i,
    )
    expect((await asOwner.findSummary(ORDER.confirmed))?.status).toBe('confirmed')
    expect(await pendingCount(db)).toBe(0)
  })

  it('refuses to change a closed order', async () => {
    await expect(asOwner.transition(ORDER.closed, 'confirmed')).rejects.toThrow(
      /cannot be changed/i,
    )
  })

  it('stamps confirmed_at and delivered_at as the order progresses', async () => {
    await asOwner.transition(ORDER.draftBySales, 'confirmed')
    const confirmed = await asOwner.findSummary(ORDER.draftBySales)
    expect(confirmed?.confirmed_at).toBeTruthy()

    await asOwner.transition(ORDER.draftBySales, 'in_production')
    await asOwner.transition(ORDER.draftBySales, 'ready')
    await asOwner.transition(ORDER.draftBySales, 'delivered')
    expect((await asOwner.findSummary(ORDER.draftBySales))?.delivered_at).toBeTruthy()
  })

  it('requires a reason to cancel, and records who cancelled', async () => {
    await expect(asManager.transition(ORDER.confirmed, 'cancelled')).rejects.toThrow(
      /give a reason/i,
    )

    await asManager.transition(ORDER.confirmed, 'cancelled', 'Client postponed the event')
    const cancelled = await asManager.findSummary(ORDER.confirmed)
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancellation_reason: 'Client postponed the event',
      cancelled_by: MANAGER,
    })
  })

  // ------------------------------------------------------ permission rules

  it('refuses to let a sales user cancel (FR-4.2)', async () => {
    await expect(
      asSales.transition(ORDER.draftBySales, 'cancelled', 'changed my mind'),
    ).rejects.toThrow(/only a manager or the owner can cancel/i)
  })

  it('lets a sales user edit their own draft but not once confirmed (FR-4.5)', async () => {
    await asSales.update(ORDER.draftBySales, { notes: 'Ready by 8am' })
    expect((await asSales.findSummary(ORDER.draftBySales))?.notes).toBe('Ready by 8am')

    await asSales.transition(ORDER.draftBySales, 'confirmed')
    await expect(asSales.update(ORDER.draftBySales, { notes: 'too late' })).rejects.toThrow(
      /only edit your own orders while they are still a draft/i,
    )
  })

  it("hides another sales user's order entirely (FR-4.5)", async () => {
    expect(await asSales.findSummary(ORDER.draftByOtherSales)).toBeNull()
    await expect(asSales.update(ORDER.draftByOtherSales, { notes: 'x' })).rejects.toThrow(
      /not found on this device/i,
    )
    // Visible to the owner, so the null is scope and not absence.
    expect(await asOwner.findSummary(ORDER.draftByOtherSales)).not.toBeNull()
  })

  it('never lets a sales user delete an order (FR-4.5)', async () => {
    await expect(asSales.softDelete(ORDER.draftBySales)).rejects.toBeInstanceOf(OrderRuleError)
    await expect(asSales.softDelete(ORDER.draftBySales)).rejects.toThrow(
      /only a manager or the owner/i,
    )

    // A manager can.
    await asManager.softDelete(ORDER.draftBySales)
    expect(await asManager.findSummary(ORDER.draftBySales)).toBeNull()
  })

  it("scopes the list to a sales user's own orders", async () => {
    const mine = await asSales.list({ status: 'all' })
    expect(mine.map((o) => o.id)).toEqual([ORDER.draftBySales])

    expect((await asOwner.list({ status: 'all' })).length).toBe(7)
  })

  // ---------------------------------------------------------- FR-4.1 create

  it('creates an order with catalogue and free-text lines, and totals it', async () => {
    const id = 'aa000000-0000-4000-8000-000000000001'
    const created = await asSales.create({
      id,
      clientId: CLIENT,
      isWalkIn: false,
      orderType: 'event',
      deliveryAt: '2026-09-10T07:00:00.000Z',
      deliveryAddress: 'Menengai Crater Lodge',
      eventDate: '2026-09-10',
      eventVenue: 'Menengai Crater Lodge',
      eventSetupNotes: 'Arch at the entrance',
      notes: null,
      takenBy: SALES,
      discountCents: 50000,
      lines: [
        {
          key: 'ab000000-0000-4000-8000-000000000001',
          productId: PRODUCT_ROSE,
          description: 'Red Naomi Rose',
          quantity: '120',
          unitPrice: '6000',
        },
        {
          key: 'ab000000-0000-4000-8000-000000000002',
          productId: PRODUCT_GYP,
          description: 'Gypsophila',
          quantity: '8',
          unitPrice: '35000',
        },
        // FR-4.1: a custom arrangement with no catalogue product.
        {
          key: 'ab000000-0000-4000-8000-000000000003',
          productId: null,
          description: 'Stage arch, custom build',
          quantity: '1',
          unitPrice: '4500000',
        },
      ],
    })

    // 120*6000 + 8*35000 + 4,500,000 = 720,000 + 280,000 + 4,500,000
    expect(created.subtotal_cents).toBe(5500000)
    expect(created.total_cents).toBe(5450000) // less the 50,000 discount
    expect(created.status).toBe('draft')

    const detail = await asSales.detail(id)
    expect(detail?.items).toHaveLength(3)
    expect(detail?.items[2]).toMatchObject({
      product_id: null,
      description: 'Stage arch, custom build',
      line_total_cents: 4500000,
    })
    // Quantities survive the thousandths codec.
    expect(detail?.items[0]?.quantity).toBe(120)
  })

  it('refuses an order with no lines', async () => {
    await expect(
      asSales.create({
        id: 'aa000000-0000-4000-8000-000000000002',
        clientId: CLIENT,
        isWalkIn: false,
        orderType: 'standard',
        deliveryAt: null,
        deliveryAddress: null,
        eventDate: null,
        eventVenue: null,
        eventSetupNotes: null,
        notes: null,
        takenBy: SALES,
        discountCents: 0,
        lines: [],
      }),
    ).rejects.toThrow(/at least one line/i)
  })

  // ------------------------------------------------------ FR-4.7 deliveries

  it('groups upcoming deliveries by day and excludes finished orders', async () => {
    const groups = await asOwner.upcomingDeliveries('2026-09-01T00:00:00.000Z')
    const dates = groups.map((g) => g.date)

    expect(dates).toEqual(['2026-09-03', '2026-09-05', '2026-09-06'])
    // Two orders share 3 September.
    expect(groups[0]?.orders).toHaveLength(2)
    // The delivered, closed and cancelled ones are not upcoming.
    const ids = groups.flatMap((g) => g.orders.map((o) => o.id))
    expect(ids).not.toContain(ORDER.closed)
    expect(ids).not.toContain(ORDER.cancelled)
    expect(ids).not.toContain(ORDER.delivered)
  })

  // -------------------------------------------------------- FR-4.4 invoicing

  it('converts a confirmed order into a draft invoice', async () => {
    const invoiceId = 'ac000000-0000-4000-8000-000000000001'
    await asOwner.convertToInvoice(ORDER.confirmed, invoiceId)

    const detail = await asOwner.detail(ORDER.confirmed)
    expect(detail?.invoiceId).toBe(invoiceId)

    const rows = await db.select<Record<string, unknown>>(
      'SELECT status, invoice_number, total_cents, client_snapshot FROM invoices WHERE id = ?',
      [invoiceId],
    )
    // Draft, and therefore unnumbered: numbering is gap-free and server-assigned
    // when the invoice is issued (FR-5.1).
    expect(rows[0]?.['status']).toBe('draft')
    expect(rows[0]?.['invoice_number']).toBeNull()
    expect(rows[0]?.['total_cents']).toBe(100000)
    expect(String(rows[0]?.['client_snapshot'])).toContain('Menengai')
  })

  it('charges no VAT while the business is not registered (PRD §12.3 default)', async () => {
    const invoiceId = 'ac000000-0000-4000-8000-000000000010'
    await asOwner.convertToInvoice(ORDER.confirmed, invoiceId)

    const rows = await db.select<Record<string, unknown>>(
      'SELECT vat_rate_bp, vat_cents, total_cents FROM invoices WHERE id = ?',
      [invoiceId],
    )
    expect(rows[0]).toMatchObject({ vat_rate_bp: 0, vat_cents: 0, total_cents: 100000 })
  })

  it('adds VAT once the setting is switched on, with no code change', async () => {
    // FR-9.2: the rate and the switch live in tax_config, so this is the whole
    // change a VAT registration requires.
    await db.execute('UPDATE tax_config SET is_vat_enabled = 1')

    const invoiceId = 'ac000000-0000-4000-8000-000000000011'
    await asOwner.convertToInvoice(ORDER.confirmed, invoiceId)

    const rows = await db.select<Record<string, unknown>>(
      'SELECT vat_rate_bp, vat_cents, subtotal_cents, total_cents FROM invoices WHERE id = ?',
      [invoiceId],
    )
    // The seeded order line is 20,000 x 6,000 = 120,000 cents; 16% is 19,200.
    expect(rows[0]).toMatchObject({ vat_rate_bp: 1600, vat_cents: 19200 })
    // VAT is added on top of the order total, not absorbed into it.
    expect(Number(rows[0]?.['total_cents'])).toBe(100000 + 19200)
  })

  it('refuses to invoice a draft or a cancelled order', async () => {
    await expect(
      asOwner.convertToInvoice(ORDER.draftBySales, 'ac000000-0000-4000-8000-000000000002'),
    ).rejects.toThrow(/confirm the order/i)

    await expect(
      asOwner.convertToInvoice(ORDER.cancelled, 'ac000000-0000-4000-8000-000000000003'),
    ).rejects.toThrow(/cancelled order cannot be invoiced/i)
  })

  it('reports the invoice on the order as soon as it exists', async () => {
    // The drawer decides whether to offer "Create invoice" from this field.
    // It read stale detail once and went on offering an action already taken.
    expect((await asOwner.detail(ORDER.confirmed))?.invoiceId).toBeNull()

    const invoiceId = 'ac000000-0000-4000-8000-000000000006'
    await asOwner.convertToInvoice(ORDER.confirmed, invoiceId)

    const after = await asOwner.detail(ORDER.confirmed)
    expect(after?.invoiceId).toBe(invoiceId)
    expect(after?.invoiceNumber).toBeNull()
  })

  it('refuses to invoice the same order twice', async () => {
    await asOwner.convertToInvoice(ORDER.confirmed, 'ac000000-0000-4000-8000-000000000004')
    await expect(
      asOwner.convertToInvoice(ORDER.confirmed, 'ac000000-0000-4000-8000-000000000005'),
    ).rejects.toThrow(/already has an invoice/i)
  })
})
