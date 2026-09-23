import { describe, expect, it } from 'vitest'

import { createDevice } from '../../../data/__tests__/harness.js'
import { MockServer } from '../../../data/__tests__/mockServer.js'
import { OrdersRepository } from '../ordersRepository.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const SALES = '44444444-4444-4444-8444-444444444444'
const CLIENT = 'c0000000-0000-4000-8000-000000000002'
const PRODUCT = '40000000-0000-4000-8000-000000000001'

async function seedShared(server: MockServer) {
  server.seed('clients', {
    id: CLIENT,
    name: 'Menengai Events & Planning',
    client_type: 'event_planner',
    credit_terms_days: 30,
    deleted_at: null,
  })
  server.seed('products', {
    id: PRODUCT,
    sku: 'RSS-ROS-001',
    name: 'Red Naomi Rose',
    unit: 'stem',
    selling_price_cents: 6000,
    is_active: true,
    deleted_at: null,
  })
}

function repoFor(
  device: Awaited<ReturnType<typeof createDevice>>,
  role: 'owner' | 'sales',
  userId: string,
) {
  return new OrdersRepository(device.db, { role, userId }, { userId })
}

describe('creating an order offline', () => {
  it('saves locally, queues order and lines, and syncs on reconnect', async () => {
    const server = new MockServer()
    await seedShared(server)

    const phone = await createDevice(server, SALES)
    const desktop = await createDevice(server, OWNER)
    await phone.sync()
    await desktop.sync()

    const repo = repoFor(phone, 'sales', SALES)

    server.setOffline(true)

    const orderId = 'aa000000-0000-4000-8000-000000000001'
    const created = await repo.create({
      id: orderId,
      clientId: CLIENT,
      isWalkIn: false,
      orderType: 'standard',
      deliveryAt: '2026-09-10T07:00:00.000Z',
      deliveryAddress: 'Milimani, Nakuru',
      eventDate: null,
      eventVenue: null,
      eventSetupNotes: null,
      notes: 'Taken with no connection',
      takenBy: SALES,
      discountCents: 0,
      lines: [
        {
          key: 'ab000000-0000-4000-8000-000000000001',
          productId: PRODUCT,
          description: 'Red Naomi Rose',
          quantity: '150',
          unitPrice: '6000',
        },
        {
          key: 'ab000000-0000-4000-8000-000000000002',
          productId: null,
          description: 'Ribbon and wrap',
          quantity: '1',
          unitPrice: '80000',
        },
      ],
    })

    // Usable immediately — the UI never waited on the network.
    expect(created.total_cents).toBe(980000)
    expect(await repo.detail(orderId)).toMatchObject({ items: expect.any(Array) })
    // One order + two lines queued.
    expect(await phone.pending()).toBe(3)
    expect(server.count('orders')).toBe(0)

    server.setOffline(false)
    const outcome = await phone.sync()

    expect(outcome.error).toBeNull()
    expect(outcome.pushed).toBe(3)
    expect(await phone.pending()).toBe(0)
    expect(server.count('orders')).toBe(1)
    expect(server.count('order_items')).toBe(2)

    // The owner's device receives the order and both lines.
    await desktop.sync()
    const seen = await repoFor(desktop, 'owner', OWNER).detail(orderId)
    expect(seen?.order.clientName).toBe('Menengai Events & Planning')
    expect(seen?.items).toHaveLength(2)
    expect(seen?.items[1]?.description).toBe('Ribbon and wrap')

    await phone.close()
    await desktop.close()
  })

  it('syncs a status change made offline', async () => {
    const server = new MockServer()
    await seedShared(server)
    const device = await createDevice(server, OWNER)
    await device.sync()
    const repo = repoFor(device, 'owner', OWNER)

    const orderId = 'aa000000-0000-4000-8000-000000000002'
    await repo.create({
      id: orderId,
      clientId: CLIENT,
      isWalkIn: false,
      orderType: 'standard',
      deliveryAt: null,
      deliveryAddress: null,
      eventDate: null,
      eventVenue: null,
      eventSetupNotes: null,
      notes: null,
      takenBy: OWNER,
      discountCents: 0,
      lines: [
        {
          key: 'ab000000-0000-4000-8000-000000000003',
          productId: PRODUCT,
          description: 'Rose',
          quantity: '10',
          unitPrice: '6000',
        },
      ],
    })
    await device.sync()

    server.setOffline(true)
    await repo.transition(orderId, 'confirmed')
    await repo.transition(orderId, 'in_production')
    server.setOffline(false)

    await device.sync()

    // Two edits to one row collapse to a single queue entry, and the server
    // ends on the final state.
    expect(server.rows('orders')[0]).toMatchObject({ status: 'in_production' })

    await device.close()
  })

  it('carries an offline invoice conversion up on the next sync', async () => {
    const server = new MockServer()
    await seedShared(server)
    const device = await createDevice(server, OWNER)
    await device.sync()
    const repo = repoFor(device, 'owner', OWNER)

    const orderId = 'aa000000-0000-4000-8000-000000000003'
    await repo.create({
      id: orderId,
      clientId: CLIENT,
      isWalkIn: false,
      orderType: 'standard',
      deliveryAt: null,
      deliveryAddress: null,
      eventDate: null,
      eventVenue: null,
      eventSetupNotes: null,
      notes: null,
      takenBy: OWNER,
      discountCents: 0,
      lines: [
        {
          key: 'ab000000-0000-4000-8000-000000000004',
          productId: PRODUCT,
          description: 'Rose',
          quantity: '10',
          unitPrice: '6000',
        },
      ],
    })
    await repo.transition(orderId, 'confirmed')

    server.setOffline(true)
    const invoiceId = 'ac000000-0000-4000-8000-000000000001'
    await repo.convertToInvoice(orderId, invoiceId)
    server.setOffline(false)

    await device.sync()

    expect(server.count('invoices')).toBe(1)
    // Still a draft with no number: numbering is server-assigned at issue.
    expect(server.rows('invoices')[0]).toMatchObject({ status: 'draft', order_id: orderId })
    expect(server.rows('invoices')[0]?.['invoice_number']).toBeUndefined()

    await device.close()
  })
})
