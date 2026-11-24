import { beforeEach, describe, expect, it } from 'vitest'

import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { OrdersRepository } from '../../orders/ordersRepository.js'
import { PackhouseRepository, PackhouseRuleError, derivedId } from '../packhouseRepository.js'
import { isoWeek } from '../types.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const TS = '2026-11-01T00:00:00.000Z'
const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const BABY_BLUE = 'p0000000-0000-4000-8000-000000000001'
const SILVER_DOLLAR = 'p0000000-0000-4000-8000-000000000002'
const DELIVERY = 'd0000000-0000-4000-8000-000000000001'

async function seeded(): Promise<SqlDatabase> {
  const db = openNodeDatabase()
  await migrateLocalSchema(db)
  await db.execute(
    `INSERT INTO clients (id, name, client_type, created_at, updated_at, sync_status)
     VALUES (?, 'Kabuku Packhouse', 'corporate', ?, ?, 'synced')`,
    [CLIENT, TS, TS],
  )
  const product = (id: string, name: string, selling: number) =>
    db.execute(
      `INSERT INTO products (id, sku, name, unit, cost_price_cents, selling_price_cents,
                             is_active, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, 'stem', 300, ?, 1, ?, ?, 'synced')`,
      [id, name.toUpperCase(), name, selling, TS, TS],
    )
  await product(BABY_BLUE, 'Baby Blue', 1200)
  await product(SILVER_DOLLAR, 'Silver Dollar', 1500)
  return db
}

describe('pack house', () => {
  let db: SqlDatabase
  let repo: PackhouseRepository
  let orders: OrdersRepository

  beforeEach(async () => {
    db = await seeded()
    const context = { userId: OWNER }
    repo = new PackhouseRepository(db, 'owner', context, () => '2026-11-14T08:00:00.000Z')
    orders = new OrdersRepository(db, { role: 'owner', userId: OWNER }, context)
    await repo.create({
      id: DELIVERY,
      clientId: CLIENT,
      deliveryDate: '2026-11-14',
      deliveryNoteNumber: 'DN-290',
      gatepassNumber: '290',
      notes: null,
      lines: [
        { id: 'l1', productId: BABY_BLUE, stemLengthCm: 55, quantitySent: 11_350 },
        { id: 'l2', productId: SILVER_DOLLAR, stemLengthCm: 55, quantitySent: 1_700 },
      ],
    })
  })

  it('heads the delivery with the pack house week number', async () => {
    expect(isoWeek('2026-11-14')).toBe(46)
    const [summary] = await repo.list()
    expect(summary).toMatchObject({ week: 46, sent: 13_050, status: 'dispatched' })
  })

  it('derives accepted and short from the intake report', async () => {
    await repo.recordIntake(DELIVERY, {
      grnNumber: 'GRN-77',
      arrivalTempC: 6.5,
      qcOfficer: 'Juma',
      packhouseManager: 'Nelius',
      lines: [
        {
          id: 'l1',
          quantityReceived: 11_300,
          rejectedPrimary: 200,
          rejectedSecondary: 100,
          rejectionCodes: [16, 3, 3],
        },
        {
          id: 'l2',
          quantityReceived: 1_700,
          rejectedPrimary: 0,
          rejectedSecondary: 0,
          rejectionCodes: [],
        },
      ],
    })

    const detail = await repo.detail(DELIVERY)
    expect(detail).toMatchObject({
      status: 'received',
      arrival_temp_c: 6.5,
      received: 13_000,
      rejected: 300,
      accepted: 12_700,
    })
    expect(detail?.lines[0]?.rejection_codes).toEqual([3, 16])

    const quality = await repo.quality('2026-11-01', '2026-11-30')
    expect(quality[0]).toMatchObject({ product_name: 'Baby Blue', accepted: 11_000 })
    expect(await repo.reasons('2026-11-01', '2026-11-30')).toEqual([
      { code: 3, label: 'Broken stems', lines: 1 },
      { code: 16, label: 'Breakages', lines: 1 },
    ])
  })

  it('refuses rejections without a reason code, or more than were received', async () => {
    const line2 = {
      id: 'l2',
      quantityReceived: 1_700,
      rejectedPrimary: 0,
      rejectedSecondary: 0,
      rejectionCodes: [],
    }
    const report = (line1: object) => ({
      grnNumber: null,
      arrivalTempC: null,
      qcOfficer: null,
      packhouseManager: null,
      lines: [
        {
          id: 'l1',
          quantityReceived: 100,
          rejectedPrimary: 0,
          rejectedSecondary: 0,
          rejectionCodes: [],
          ...line1,
        },
        line2,
      ],
    })
    await expect(repo.recordIntake(DELIVERY, report({ rejectedPrimary: 5 }))).rejects.toThrow(
      /reason code/,
    )
    await expect(
      repo.recordIntake(
        DELIVERY,
        report({ rejectedPrimary: 90, rejectedSecondary: 20, rejectionCodes: [1] }),
      ),
    ).rejects.toThrow(/more stems rejected/)
    await expect(
      repo.recordIntake(DELIVERY, report({ rejectedPrimary: 1, rejectionCodes: [99] })),
    ).rejects.toThrow(/not on the intake sheet/)
  })

  it('settles into one order for accepted stems and wastage for the rest, exactly once', async () => {
    await expect(repo.settle(DELIVERY, orders)).rejects.toBeInstanceOf(PackhouseRuleError)
    await repo.recordIntake(DELIVERY, {
      grnNumber: null,
      arrivalTempC: null,
      qcOfficer: null,
      packhouseManager: null,
      lines: [
        {
          id: 'l1',
          quantityReceived: 11_300,
          rejectedPrimary: 300,
          rejectedSecondary: 0,
          rejectionCodes: [3],
        },
        {
          id: 'l2',
          quantityReceived: 1_700,
          rejectedPrimary: 0,
          rejectedSecondary: 0,
          rejectionCodes: [],
        },
      ],
    })

    const orderId = await derivedId(`packhouse-order:${DELIVERY}`)
    const first = await repo.settle(DELIVERY, orders)
    const again = await repo.settle(DELIVERY, orders)

    expect(first).toEqual({ orderId, wastageLines: 2 })
    expect(again).toEqual({ orderId, wastageLines: 0 })

    const order = await orders.detail(orderId)
    expect(order?.items.map((item) => [item.quantity, item.unit_price_cents])).toEqual([
      [11_000, 1200],
      [1_700, 1500],
    ])
    const wastage = await db.select<{ quantity: number; reason: string }>(
      `SELECT quantity, reason FROM stock_movements WHERE movement_type = 'wastage' ORDER BY quantity`,
    )
    expect(wastage.map((row) => row.quantity / 1000)).toEqual([-300, -50])
    expect(wastage[0]?.reason).toMatch(/DN-290: 3 Broken stems/)

    await expect(
      repo.recordIntake(DELIVERY, {
        grnNumber: null,
        arrivalTempC: null,
        qcOfficer: null,
        packhouseManager: null,
        lines: [],
      }),
    ).rejects.toThrow(/already settled/)
  })

  it('finds the order an interrupted settle already wrote instead of raising a second', async () => {
    await repo.recordIntake(DELIVERY, {
      grnNumber: null,
      arrivalTempC: null,
      qcOfficer: null,
      packhouseManager: null,
      lines: [
        {
          id: 'l1',
          quantityReceived: 11_350,
          rejectedPrimary: 0,
          rejectedSecondary: 0,
          rejectionCodes: [],
        },
        {
          id: 'l2',
          quantityReceived: 1_700,
          rejectedPrimary: 0,
          rejectedSecondary: 0,
          rejectionCodes: [],
        },
      ],
    })
    await repo.settle(DELIVERY, orders)
    // The order was written but the link to it was lost.
    await db.execute('UPDATE packhouse_deliveries SET order_id = NULL WHERE id = ?', [DELIVERY])

    const retried = await repo.settle(DELIVERY, orders)

    expect(retried.orderId).toBe(await derivedId(`packhouse-order:${DELIVERY}`))
    const [count] = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM orders')
    expect(count?.n).toBe(1)
    const [items] = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM order_items')
    expect(items?.n).toBe(2)
  })

  it('derives the same id on every device', async () => {
    const id = await derivedId('packhouse-order:x')
    expect(id).toBe(await derivedId('packhouse-order:x'))
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).not.toBe(await derivedId('packhouse-order:y'))
  })

  it('keeps the accountant to reading', async () => {
    const accountant = new PackhouseRepository(db, 'accountant', { userId: OWNER })
    expect(await accountant.list()).toHaveLength(1)
    await expect(accountant.cancel(DELIVERY)).rejects.toThrow(/owner or manager/)
  })
})
