import { beforeEach, describe, expect, it } from 'vitest'

import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import type { Role } from '../../../auth/session.js'
import { DashboardRepository, toCsv } from '../dashboardRepository.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const SALES = '44444444-4444-4444-8444-444444444444'

const CLIENT = {
  lanet: 'c0000000-0000-4000-8000-000000000001',
  menengai: 'c0000000-0000-4000-8000-000000000002',
} as const

const PRODUCT = {
  cinerea: '40000000-0000-4000-8000-000000000001',
  parvifolia: '40000000-0000-4000-8000-000000000002',
} as const

/** 2026-09-16T09:00Z is 12:00 in Nairobi, comfortably inside the same day. */
const NOW = '2026-09-16T09:00:00.000Z'
const TODAY = '2026-09-16'

let db: SqlDatabase

async function seed(): Promise<SqlDatabase> {
  const database = openNodeDatabase()
  await migrateLocalSchema(database)

  await database.execute(
    `INSERT INTO categories (id, name, slug, is_vatable, position, created_at, updated_at, sync_status)
     VALUES ('ca000000-0000-4000-8000-000000000001', 'Cut foliage', 'cut_foliage', 1, 1, ?, ?, 'synced')`,
    [NOW, NOW],
  )

  const client = async (id: string, name: string, createdBy: string) =>
    database.execute(
      `INSERT INTO clients (id, name, client_type, created_at, updated_at, created_by, sync_status)
       VALUES (?, ?, 'business', ?, ?, ?, 'synced')`,
      [id, name, NOW, NOW, createdBy],
    )

  await client(CLIENT.lanet, 'Lanet Gardens Hotel', OWNER)
  await client(CLIENT.menengai, 'Menengai Events', SALES)

  const product = async (id: string, sku: string, name: string, threshold: number) =>
    database.execute(
      `INSERT INTO products (id, sku, name, category_id, unit, cost_price_cents, selling_price_cents,
                             low_stock_threshold, is_active, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, 'ca000000-0000-4000-8000-000000000001', 'bundle', 12000, 24000, ?, 1, ?, ?, 'synced')`,
      [id, sku, name, threshold * 1000, NOW, NOW],
    )

  await product(PRODUCT.cinerea, 'RSS-EUC-001', 'Eucalyptus Cinerea', 10)
  await product(PRODUCT.parvifolia, 'RSS-EUC-002', 'Eucalyptus Parvifolia', 5)

  return database
}

async function givenOrder(
  database: SqlDatabase,
  order: {
    id: string
    clientId: string
    totalCents: number
    createdAt: string
    createdBy: string
    status?: string
    /** Omitted is 'KES'; null is a row written before the column existed. */
    currency?: string | null
  },
): Promise<void> {
  await database.execute(
    `INSERT INTO orders (id, client_id, is_walk_in, status, order_type, subtotal_cents,
                         discount_cents, total_cents, created_at, updated_at, created_by,
                         currency, sync_status)
     VALUES (?, ?, 0, ?, 'standard', ?, 0, ?, ?, ?, ?, ?, 'synced')`,
    [
      order.id,
      order.clientId,
      order.status ?? 'delivered',
      order.totalCents,
      order.totalCents,
      order.createdAt,
      order.createdAt,
      order.createdBy,
      order.currency === undefined ? 'KES' : order.currency,
    ],
  )
}

async function givenOrderItem(
  database: SqlDatabase,
  item: { id: string; orderId: string; productId: string; quantity: number; totalCents: number },
): Promise<void> {
  await database.execute(
    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents,
                              discount_cents, line_total_cents, position, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?, 'synced')`,
    [
      item.id,
      item.orderId,
      item.productId,
      item.quantity * 1000,
      Math.round(item.totalCents / item.quantity),
      item.totalCents,
      NOW,
      NOW,
    ],
  )
}

async function givenInvoice(
  database: SqlDatabase,
  invoice: {
    id: string
    clientId: string
    totalCents: number
    dueDate: string
    createdBy: string
    status?: string
    currency?: string | null
  },
): Promise<void> {
  await database.execute(
    `INSERT INTO invoices (id, client_id, status, issue_date, due_date, subtotal_cents,
                           discount_cents, vat_rate_bp, vat_cents, total_cents,
                           created_at, updated_at, created_by, currency, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, 'synced')`,
    [
      invoice.id,
      invoice.clientId,
      invoice.status ?? 'issued',
      TODAY,
      invoice.dueDate,
      invoice.totalCents,
      invoice.totalCents,
      NOW,
      NOW,
      invoice.createdBy,
      invoice.currency === undefined ? 'KES' : invoice.currency,
    ],
  )
}

function repoFor(database: SqlDatabase, role: Role = 'owner', userId = OWNER) {
  return new DashboardRepository(database, role, userId, () => NOW)
}

beforeEach(async () => {
  db = await seed()
})

describe('daily summary (FR-2.1)', () => {
  it('counts today only', async () => {
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 500_000,
      createdAt: NOW,
      createdBy: OWNER,
    })
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 900_000,
      createdAt: '2026-09-01T09:00:00.000Z',
      createdBy: OWNER,
    })

    const summary = await repoFor(db).dailySummary(TODAY)
    expect(summary.sales).toEqual([{ currency: 'KES', cents: 500_000 }])
    expect(summary.orderCount).toBe(1)
  })

  it('counts an order by its Nairobi day, not its UTC day', async () => {
    // 2026-09-15T23:16Z is 02:16 on the 16th in Nairobi (UTC+3, no DST), so it
    // belongs to today's takings. Comparing the stored UTC date against a
    // Nairobi "today" silently drops every order placed between midnight and
    // 03:00 local — the early-morning market run this business actually does.
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 250_000,
      createdAt: '2026-09-15T23:16:02.000Z',
      createdBy: OWNER,
    })

    const summary = await repoFor(db).dailySummary(TODAY)
    expect(summary.orderCount).toBe(1)
    expect(summary.sales).toEqual([{ currency: 'KES', cents: 250_000 }])
  })

  it('excludes cancelled orders from sales', async () => {
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 500_000,
      createdAt: NOW,
      createdBy: OWNER,
      status: 'cancelled',
    })

    const summary = await repoFor(db).dailySummary(TODAY)
    expect(summary.sales).toEqual([])
    expect(summary.orderCount).toBe(0)
  })

  it('reports outstanding receivables net of payments', async () => {
    const invoiceId = crypto.randomUUID()
    await givenInvoice(db, {
      id: invoiceId,
      clientId: CLIENT.lanet,
      totalCents: 1_000_000,
      dueDate: '2026-09-30',
      createdBy: OWNER,
    })
    await db.execute(
      `INSERT INTO payments (id, invoice_id, amount_cents, method, paid_at, created_at, sync_status)
       VALUES (?, ?, 400000, 'mpesa', ?, ?, 'synced')`,
      [crypto.randomUUID(), invoiceId, NOW, NOW],
    )

    const summary = await repoFor(db).dailySummary(TODAY)
    expect(summary.outstandingReceivables).toEqual([{ currency: 'KES', cents: 600_000 }])
    expect(summary.paymentsReceived).toEqual([{ currency: 'KES', cents: 400_000 }])
  })

  it('adds a reversed payment back to receivables and out of collections (FR-5.5)', async () => {
    const invoiceId = crypto.randomUUID()
    const paymentId = crypto.randomUUID()
    await givenInvoice(db, {
      id: invoiceId,
      clientId: CLIENT.lanet,
      totalCents: 1_000_000,
      dueDate: '2026-09-30',
      createdBy: OWNER,
    })
    await db.execute(
      `INSERT INTO payments (id, invoice_id, amount_cents, method, paid_at, created_at, sync_status)
       VALUES (?, ?, 400000, 'mpesa', ?, ?, 'synced')`,
      [paymentId, invoiceId, NOW, NOW],
    )
    await db.execute(
      `INSERT INTO reversals (id, payment_id, amount_cents, reason, reversed_at, created_at, sync_status)
       VALUES (?, ?, 150000, 'Bounced', ?, ?, 'synced')`,
      [crypto.randomUUID(), paymentId, NOW, NOW],
    )

    const summary = await repoFor(db).dailySummary(TODAY)
    expect(summary.outstandingReceivables).toEqual([{ currency: 'KES', cents: 750_000 }])
    expect(summary.paymentsReceived).toEqual([{ currency: 'KES', cents: 250_000 }])
    const aging = await repoFor(db).receivablesAging(TODAY)
    expect(aging.reduce((sum, b) => sum + b.amountCents, 0)).toBe(750_000)
  })

  it('ignores draft and voided invoices', async () => {
    await givenInvoice(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 1_000_000,
      dueDate: '2026-09-30',
      createdBy: OWNER,
      status: 'draft',
    })

    const summary = await repoFor(db).dailySummary(TODAY)
    expect(summary.outstandingReceivables).toEqual([])
  })
})

describe('role scoping (FR-2.8)', () => {
  it('shows a sales user only their own orders', async () => {
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 500_000,
      createdAt: NOW,
      createdBy: OWNER,
    })
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.menengai,
      totalCents: 300_000,
      createdAt: NOW,
      createdBy: SALES,
    })

    expect((await repoFor(db).dailySummary(TODAY)).sales).toEqual([
      { currency: 'KES', cents: 800_000 },
    ])
    expect((await repoFor(db, 'sales', SALES).dailySummary(TODAY)).sales).toEqual([
      { currency: 'KES', cents: 300_000 },
    ])
  })

  it('scopes the receivables figure too', async () => {
    await givenInvoice(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 1_000_000,
      dueDate: '2026-09-30',
      createdBy: OWNER,
    })
    await givenInvoice(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.menengai,
      totalCents: 250_000,
      dueDate: '2026-09-30',
      createdBy: SALES,
    })

    expect((await repoFor(db).dailySummary(TODAY)).outstandingReceivables).toEqual([
      { currency: 'KES', cents: 1_250_000 },
    ])
    expect((await repoFor(db, 'sales', SALES).dailySummary(TODAY)).outstandingReceivables).toEqual([
      { currency: 'KES', cents: 250_000 },
    ])
  })
})

describe('sales trend (FR-2.2)', () => {
  it('returns one point per day, including the empty ones', async () => {
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 500_000,
      createdAt: NOW,
      createdBy: OWNER,
    })

    const trend = await repoFor(db).salesTrend(30, TODAY)
    expect(trend).toHaveLength(30)
    expect(trend[29]).toEqual({ date: TODAY, salesCents: 500_000, orderCount: 1 })
    expect(trend[0]?.date).toBe('2026-08-18')
    expect(trend[0]?.salesCents).toBe(0)
  })

  it('keeps the days in ascending order', async () => {
    const trend = await repoFor(db).salesTrend(7, TODAY)
    const dates = trend.map((point) => point.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('rankings (FR-2.3)', () => {
  it('ranks clients by value this month', async () => {
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 500_000,
      createdAt: NOW,
      createdBy: OWNER,
    })
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.menengai,
      totalCents: 900_000,
      createdAt: NOW,
      createdBy: OWNER,
    })

    const top = await repoFor(db).topClients(5, '2026-09')
    expect(top[0]?.name).toBe('Menengai Events')
    expect(top[0]?.totalCents).toBe(900_000)
  })

  it('ranks products by value, not quantity', async () => {
    const orderId = crypto.randomUUID()
    await givenOrder(db, {
      id: orderId,
      clientId: CLIENT.lanet,
      totalCents: 800_000,
      createdAt: NOW,
      createdBy: OWNER,
    })
    // Many cheap bundles versus few expensive ones.
    await givenOrderItem(db, {
      id: crypto.randomUUID(),
      orderId,
      productId: PRODUCT.cinerea,
      quantity: 100,
      totalCents: 300_000,
    })
    await givenOrderItem(db, {
      id: crypto.randomUUID(),
      orderId,
      productId: PRODUCT.parvifolia,
      quantity: 10,
      totalCents: 500_000,
    })

    const top = await repoFor(db).topProducts(5, '2026-09')
    expect(top[0]?.sku).toBe('RSS-EUC-002')
    expect(top[0]?.quantity).toBe(10)
    expect(top[1]?.quantity).toBe(100)
  })
})

describe('receivables aging (FR-2.4)', () => {
  it('buckets by how far past due each invoice is', async () => {
    const cases: Array<[string, number]> = [
      ['2026-09-10', 100_000], // 6 days
      ['2026-08-10', 200_000], // 37 days
      ['2026-07-10', 300_000], // 68 days
      ['2026-01-10', 400_000], // 249 days
    ]
    for (const [dueDate, total] of cases) {
      await givenInvoice(db, {
        id: crypto.randomUUID(),
        clientId: CLIENT.lanet,
        totalCents: total,
        dueDate,
        createdBy: OWNER,
      })
    }

    const buckets = await repoFor(db).receivablesAging(TODAY)
    expect(buckets.map((bucket) => bucket.amountCents)).toEqual([
      100_000, 200_000, 300_000, 400_000,
    ])
  })

  it('puts a not-yet-due invoice in the first bucket', async () => {
    await givenInvoice(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 50_000,
      dueDate: '2026-12-31',
      createdBy: OWNER,
    })

    const buckets = await repoFor(db).receivablesAging(TODAY)
    expect(buckets[0]?.amountCents).toBe(50_000)
  })
})

describe('alerts (FR-2.5, FR-2.6)', () => {
  it('totals what is owed to suppliers', async () => {
    await db.execute(
      `INSERT INTO suppliers (id, name, payment_terms_days, created_at, updated_at, sync_status)
       VALUES ('50000000-0000-4000-8000-000000000001', 'Njoro Farm', 30, ?, ?, 'synced')`,
      [NOW, NOW],
    )
    await db.execute(
      `INSERT INTO purchases (id, supplier_id, status, purchase_date, total_cents,
                              created_at, updated_at, sync_status)
       VALUES (?, '50000000-0000-4000-8000-000000000001', 'received', ?, 700000, ?, ?, 'synced')`,
      [crypto.randomUUID(), TODAY, NOW, NOW],
    )

    expect(await repoFor(db).payablesTotalCents()).toBe(700_000)
  })

  it('flags products at or below their own threshold, worst first', async () => {
    await db.execute(
      `INSERT INTO stock_movements (id, product_id, movement_type, quantity, source_table,
                                    occurred_at, created_at, sync_status)
       VALUES (?, ?, 'purchase_in', ?, 'manual', ?, ?, 'synced')`,
      [crypto.randomUUID(), PRODUCT.cinerea, 2 * 1000, NOW, NOW],
    )
    await db.execute(
      `INSERT INTO stock_movements (id, product_id, movement_type, quantity, source_table,
                                    occurred_at, created_at, sync_status)
       VALUES (?, ?, 'sale', ?, 'manual', ?, ?, 'synced')`,
      [crypto.randomUUID(), PRODUCT.parvifolia, -3 * 1000, NOW, NOW],
    )

    const alerts = await repoFor(db).lowStockAlerts()
    expect(alerts).toHaveLength(2)
    // Parvifolia is 8 below its threshold; cinerea is 8 below too but negative sorts first.
    expect(alerts[0]?.isNegative).toBe(true)
    expect(alerts[0]?.currentStock).toBe(-3)
  })

  it('does not lose a fraction of a cent on a fractional quantity', async () => {
    // 1.5 units at 13.33 each = 19.995, which must round to 20.00 rather than
    // truncate to 19.99. SQLite divides integers towards zero, so doing the
    // /1000 inside the aggregate silently drops it.
    await db.execute(
      `INSERT INTO stock_movements (id, product_id, movement_type, quantity, unit_cost_cents,
                                    reason, source_table, occurred_at, created_at, sync_status)
       VALUES (?, ?, 'wastage', ?, 1333, 'Part bundle spoiled', 'manual', ?, ?, 'synced')`,
      [crypto.randomUUID(), PRODUCT.cinerea, -1.5 * 1000, NOW, NOW],
    )

    const wastage = await repoFor(db).wastageAlert(30, TODAY)
    expect(wastage.totalCostCents).toBe(2000)
  })

  it('costs wastage at the movement cost', async () => {
    await db.execute(
      `INSERT INTO stock_movements (id, product_id, movement_type, quantity, unit_cost_cents,
                                    reason, source_table, occurred_at, created_at, sync_status)
       VALUES (?, ?, 'wastage', ?, 15000, 'Spoiled in transit', 'manual', ?, ?, 'synced')`,
      [crypto.randomUUID(), PRODUCT.cinerea, -4 * 1000, NOW, NOW],
    )

    const wastage = await repoFor(db).wastageAlert(30, TODAY)
    expect(wastage.totalCostCents).toBe(60_000)
    expect(wastage.occurrences).toBe(1)
    expect(wastage.topProduct).toBe('Eucalyptus Cinerea')
  })
})

describe('sales in more than one currency', () => {
  async function givenMixedSales(): Promise<void> {
    // KES 5,000 and USD 108 today; a pre-currency (NULL) order of KES 2,000.
    const kesOrder = crypto.randomUUID()
    const usdOrder = crypto.randomUUID()
    await givenOrder(db, {
      id: kesOrder,
      clientId: CLIENT.lanet,
      totalCents: 500_000,
      createdAt: NOW,
      createdBy: OWNER,
    })
    await givenOrder(db, {
      id: usdOrder,
      clientId: CLIENT.menengai,
      totalCents: 10_800,
      createdAt: NOW,
      createdBy: OWNER,
      currency: 'USD',
    })
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.menengai,
      totalCents: 200_000,
      createdAt: NOW,
      createdBy: OWNER,
      currency: null,
    })
    await givenOrderItem(db, {
      id: crypto.randomUUID(),
      orderId: kesOrder,
      productId: PRODUCT.cinerea,
      quantity: 10,
      totalCents: 500_000,
    })
    await givenOrderItem(db, {
      id: crypto.randomUUID(),
      orderId: usdOrder,
      productId: PRODUCT.parvifolia,
      quantity: 4,
      totalCents: 10_800,
    })

    const kesInvoice = crypto.randomUUID()
    const usdInvoice = crypto.randomUUID()
    await givenInvoice(db, {
      id: kesInvoice,
      clientId: CLIENT.lanet,
      totalCents: 500_000,
      dueDate: '2026-09-30',
      createdBy: OWNER,
    })
    await givenInvoice(db, {
      id: usdInvoice,
      clientId: CLIENT.menengai,
      totalCents: 10_800,
      dueDate: '2026-08-10',
      createdBy: OWNER,
      currency: 'USD',
    })
    await givenInvoice(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.menengai,
      totalCents: 200_000,
      dueDate: '2026-07-10',
      createdBy: OWNER,
      currency: null,
    })
    await db.execute(
      `INSERT INTO payments (id, invoice_id, amount_cents, method, paid_at, created_at, sync_status)
       VALUES (?, ?, 100000, 'mpesa', ?, ?, 'synced'), (?, ?, 800, 'bank', ?, ?, 'synced')`,
      [crypto.randomUUID(), kesInvoice, NOW, NOW, crypto.randomUUID(), usdInvoice, NOW, NOW],
    )
  }

  it('lists each currency separately in the summary and never adds them', async () => {
    await givenMixedSales()

    const summary = await repoFor(db).dailySummary(TODAY)
    expect(summary.sales).toEqual([
      { currency: 'KES', cents: 700_000 },
      { currency: 'USD', cents: 10_800 },
    ])
    expect(summary.orderCount).toBe(3)
    expect(summary.paymentsReceived).toEqual([
      { currency: 'KES', cents: 100_000 },
      { currency: 'USD', cents: 800 },
    ])
    expect(summary.outstandingReceivables).toEqual([
      { currency: 'KES', cents: 600_000 },
      { currency: 'USD', cents: 10_000 },
    ])
  })

  it('keeps the trend to the requested currency', async () => {
    await givenMixedSales()

    const kes = await repoFor(db).salesTrend(7, TODAY)
    expect(kes[6]).toEqual({ date: TODAY, salesCents: 700_000, orderCount: 2 })

    const usd = await repoFor(db).salesTrend(7, TODAY, 'USD')
    expect(usd[6]).toEqual({ date: TODAY, salesCents: 10_800, orderCount: 1 })
    expect(usd.slice(0, 6).every((point) => point.salesCents === 0)).toBe(true)
  })

  it('keeps the rankings to the requested currency', async () => {
    await givenMixedSales()

    const kesClients = await repoFor(db).topClients(5, '2026-09')
    expect(kesClients.map((c) => [c.name, c.totalCents])).toEqual([
      ['Lanet Gardens Hotel', 500_000],
      ['Menengai Events', 200_000],
    ])
    const usdClients = await repoFor(db).topClients(5, '2026-09', 'USD')
    expect(usdClients.map((c) => [c.name, c.totalCents])).toEqual([['Menengai Events', 10_800]])

    const kesProducts = await repoFor(db).topProducts(5, '2026-09')
    expect(kesProducts.map((p) => [p.sku, p.totalCents])).toEqual([['RSS-EUC-001', 500_000]])
    const usdProducts = await repoFor(db).topProducts(5, '2026-09', 'USD')
    expect(usdProducts.map((p) => [p.sku, p.totalCents])).toEqual([['RSS-EUC-002', 10_800]])
  })

  it('keeps the aging to the requested currency', async () => {
    await givenMixedSales()

    const kes = await repoFor(db).receivablesAging(TODAY)
    expect(kes.map((b) => b.amountCents)).toEqual([400_000, 0, 200_000, 0])

    const usd = await repoFor(db).receivablesAging(TODAY, 'USD')
    expect(usd.map((b) => b.amountCents)).toEqual([0, 10_000, 0, 0])
    expect(usd.map((b) => b.invoiceCount)).toEqual([0, 1, 0, 0])
  })

  it('counts a row with no currency as shillings', async () => {
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 300_000,
      createdAt: NOW,
      createdBy: OWNER,
      currency: null,
    })

    expect((await repoFor(db).dailySummary(TODAY)).sales).toEqual([
      { currency: 'KES', cents: 300_000 },
    ])
    expect((await repoFor(db).salesTrend(1, TODAY))[0]?.salesCents).toBe(300_000)
    expect(await repoFor(db).salesCurrencies()).toEqual(['KES'])
  })

  it('lists the currencies sales were priced in, shillings first', async () => {
    expect(await repoFor(db).salesCurrencies()).toEqual(['KES'])

    await givenMixedSales()
    expect(await repoFor(db).salesCurrencies()).toEqual(['KES', 'USD'])
  })

  it('scopes the currency list for a sales user', async () => {
    await givenOrder(db, {
      id: crypto.randomUUID(),
      clientId: CLIENT.lanet,
      totalCents: 10_800,
      createdAt: NOW,
      createdBy: OWNER,
      currency: 'USD',
    })

    expect(await repoFor(db, 'sales', SALES).salesCurrencies()).toEqual(['KES'])
  })
})

describe('CSV export (FR-2.7)', () => {
  it('quotes a field containing a comma', () => {
    const csv = toCsv(['Client', 'Total'], [['Otieno, Peter', 1200]])
    expect(csv).toBe('Client,Total\r\n"Otieno, Peter",1200')
  })

  it('doubles an embedded quote', () => {
    expect(toCsv(['Name'], [['The "Big" Farm']])).toBe('Name\r\n"The ""Big"" Farm"')
  })

  it('quotes a field containing a newline', () => {
    expect(toCsv(['Notes'], [['line one\nline two']])).toBe('Notes\r\n"line one\nline two"')
  })

  it('writes an empty cell for null and undefined', () => {
    expect(toCsv(['A', 'B'], [[null, undefined]])).toBe('A,B\r\n,')
  })
})
