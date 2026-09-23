import { describe, expect, it } from 'vitest'

import { createDevice } from '../../../data/__tests__/harness.js'
import { MockServer } from '../../../data/__tests__/mockServer.js'
import { OrdersRepository } from '../../orders/ordersRepository.js'
import { ProductsRepository } from '../productsRepository.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const MANAGER = '22222222-2222-4222-8222-222222222222'
const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const PRODUCT = '40000000-0000-4000-8000-000000000001'

async function seedShared(server: MockServer) {
  server.seed('clients', { id: CLIENT, name: 'Lanet Gardens Hotel', deleted_at: null })
  server.seed('categories', { id: 'ca1', name: 'Fresh flowers', slug: 'fresh', deleted_at: null })
  server.seed('products', {
    id: PRODUCT,
    sku: 'RSS-ROS-001',
    name: 'Red Naomi Rose',
    category_id: 'ca1',
    unit: 'stem',
    cost_price_cents: 2500,
    selling_price_cents: 6000,
    low_stock_threshold: 200,
    is_active: true,
    deleted_at: null,
  })
  server.seed('stock_movements', {
    id: 'seed-in',
    product_id: PRODUCT,
    movement_type: 'purchase_in',
    quantity: 1000,
    unit_cost_cents: 2500,
    source_table: 'manual',
    occurred_at: '2026-08-26T06:00:00.000Z',
  })
}

const products = (device: Awaited<ReturnType<typeof createDevice>>, userId: string) =>
  new ProductsRepository(device.db, { role: 'owner', userId }, { userId })
const orders = (device: Awaited<ReturnType<typeof createDevice>>, userId: string) =>
  new OrdersRepository(device.db, { role: 'owner', userId }, { userId })

describe('stock moves through sync', () => {
  /**
   * FR-6.6, the deduction event.
   *
   * The deduction itself is a server trigger — `app.deduct_stock_for_order`,
   * verified directly against Postgres. This covers the device's side of it:
   * delivering an order offline, syncing, and seeing the movement come back.
   */
  it('writes a sale movement when the order reaches the deduction point', async () => {
    const server = new MockServer()
    server.stockDeductionPoint = 'delivered'
    await seedShared(server)

    const device = await createDevice(server, OWNER)
    await device.sync()
    expect((await products(device, OWNER).findStock(PRODUCT))?.currentStock).toBe(1000)

    // Take an order for 150 stems, all offline.
    server.setOffline(true)
    const orderId = 'aa000000-0000-4000-8000-000000000001'
    const repo = orders(device, OWNER)
    await repo.create({
      id: orderId,
      clientId: CLIENT,
      isWalkIn: false,
      orderType: 'standard',
      deliveryAt: '2026-09-06T08:00:00.000Z',
      deliveryAddress: null,
      eventDate: null,
      eventVenue: null,
      eventSetupNotes: null,
      notes: null,
      takenBy: OWNER,
      discountCents: 0,
      lines: [
        {
          key: 'ab000000-0000-4000-8000-000000000001',
          productId: PRODUCT,
          description: 'Red Naomi Rose',
          quantity: '150',
          unitPrice: '6000',
        },
      ],
    })
    await repo.transition(orderId, 'confirmed')
    await repo.transition(orderId, 'in_production')
    await repo.transition(orderId, 'ready')

    // Nothing has moved: the deduction point is delivery, and nothing has synced.
    expect((await products(device, OWNER).findStock(PRODUCT))?.currentStock).toBe(1000)

    await repo.transition(orderId, 'delivered')
    server.setOffline(false)
    await device.sync()

    // The server wrote the movement when the order arrived delivered.
    const serverMovements = server
      .rows('stock_movements')
      .filter((m) => m['movement_type'] === 'sale')
    expect(serverMovements).toHaveLength(1)
    expect(serverMovements[0]).toMatchObject({ quantity: -150, source_table: 'orders' })

    // And the device sees it on the next pull.
    await device.sync()
    expect((await products(device, OWNER).findStock(PRODUCT))?.currentStock).toBe(850)

    await device.close()
  })

  it('does not deduct twice when the cycle is replayed', async () => {
    const server = new MockServer()
    server.stockDeductionPoint = 'delivered'
    await seedShared(server)
    const device = await createDevice(server, OWNER)
    await device.sync()

    const orderId = 'aa000000-0000-4000-8000-000000000002'
    const repo = orders(device, OWNER)
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
          key: 'ab000000-0000-4000-8000-000000000002',
          productId: PRODUCT,
          description: 'Rose',
          quantity: '40',
          unitPrice: '6000',
        },
      ],
    })
    for (const s of ['confirmed', 'in_production', 'ready', 'delivered'] as const) {
      await repo.transition(orderId, s)
    }
    await device.sync()
    await device.sync()
    await device.sync()

    expect(
      server.rows('stock_movements').filter((m) => m['movement_type'] === 'sale'),
    ).toHaveLength(1)
    await device.sync()
    expect((await products(device, OWNER).findStock(PRODUCT))?.currentStock).toBe(960)

    await device.close()
  })

  it('leaves stock alone until the configured point is reached', async () => {
    const server = new MockServer()
    // If the client chooses confirmation instead, the same order deducts earlier.
    server.stockDeductionPoint = 'order_confirmed'
    await seedShared(server)
    const device = await createDevice(server, OWNER)
    await device.sync()

    const orderId = 'aa000000-0000-4000-8000-000000000003'
    const repo = orders(device, OWNER)
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
          quantity: '25',
          unitPrice: '6000',
        },
      ],
    })
    await repo.transition(orderId, 'confirmed')
    await device.sync()
    await device.sync()

    expect((await products(device, OWNER).findStock(PRODUCT))?.currentStock).toBe(975)
    await device.close()
  })

  // ------------------------------------------------------- offline adjustments

  it('records wastage and adjustments offline and syncs them', async () => {
    const server = new MockServer()
    await seedShared(server)

    const phone = await createDevice(server, OWNER)
    const desktop = await createDevice(server, MANAGER)
    await phone.sync()
    await desktop.sync()

    server.setOffline(true)
    const repo = products(phone, OWNER)

    await repo.recordMovement({
      id: 'ac000000-0000-4000-8000-000000000001',
      productId: PRODUCT,
      type: 'wastage',
      quantity: 140,
      reason: 'Heat damage in transit from Naivasha',
    })
    await repo.recordMovement({
      id: 'ac000000-0000-4000-8000-000000000002',
      productId: PRODUCT,
      type: 'adjustment',
      quantity: -10,
      reason: 'Stock count 04/09',
    })

    // Usable at once, and queued.
    expect((await repo.findStock(PRODUCT))?.currentStock).toBe(850)
    expect(await phone.pending()).toBe(2)

    server.setOffline(false)
    const outcome = await phone.sync()
    expect(outcome.pushed).toBe(2)
    expect(await phone.pending()).toBe(0)

    // The other device sees both, with their reasons intact.
    await desktop.sync()
    expect((await products(desktop, MANAGER).findStock(PRODUCT))?.currentStock).toBe(850)

    const ledger = await products(desktop, MANAGER).movementLedger({ productId: PRODUCT })
    const wastage = ledger.find((m) => m.movement_type === 'wastage')
    expect(wastage?.reason).toBe('Heat damage in transit from Naivasha')
    expect(wastage?.quantity).toBe(-140)

    await phone.close()
    await desktop.close()
  })

  it('never overwrites a movement already on the server', async () => {
    const server = new MockServer()
    await seedShared(server)
    const device = await createDevice(server, OWNER)
    await device.sync()

    const id = 'ac000000-0000-4000-8000-000000000003'
    await products(device, OWNER).recordMovement({
      id,
      productId: PRODUCT,
      type: 'wastage',
      quantity: 5,
      reason: 'Dropped',
    })
    await device.sync()

    // Movements are append-only: a replayed push with different content is ignored.
    await device.remote.push(
      'stock_movements',
      [
        {
          id,
          product_id: PRODUCT,
          movement_type: 'wastage',
          quantity: -999999,
          source_table: 'manual',
        },
      ],
      { appendOnly: true },
    )
    const stored = server.rows('stock_movements').find((m) => m['id'] === id)
    // The outbox payload carries server units, not the local thousandths encoding.
    expect(stored?.['quantity']).toBe(-5)

    await device.close()
  })
})
