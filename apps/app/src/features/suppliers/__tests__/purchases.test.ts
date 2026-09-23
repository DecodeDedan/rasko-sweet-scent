import { beforeEach, describe, expect, it } from 'vitest'

import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { SupplierRuleError } from '../suppliersRepository.js'
import { canTransitionPurchase, nextPurchaseStatuses } from '../types.js'
import {
  NOW,
  PRODUCT,
  SUPPLIER,
  givenPurchase,
  givenSupplierPayment,
  repositoryFor,
  seededDatabase,
} from './fixture.js'

let db: SqlDatabase

beforeEach(async () => {
  db = await seededDatabase()
})

describe('suppliers (FR-7.1)', () => {
  it('lists suppliers with their purchase history and what is owed', async () => {
    const repo = repositoryFor(db)
    await givenPurchase(db, {
      id: 'p1000000-0000-4000-8000-000000000001',
      supplierId: SUPPLIER.njoro,
      totalCents: 500_000,
    })
    await givenSupplierPayment(db, {
      id: 'sp000000-0000-4000-8000-000000000001',
      purchaseId: 'p1000000-0000-4000-8000-000000000001',
      amountCents: 200_000,
    })

    const suppliers = await repo.listSuppliers()
    const njoro = suppliers.find((supplier) => supplier.id === SUPPLIER.njoro)

    expect(njoro?.purchaseCount).toBe(1)
    expect(njoro?.purchasedCents).toBe(500_000)
    expect(njoro?.payableCents).toBe(300_000)
  })

  it('finds a supplier by name, contact or phone', async () => {
    const repo = repositoryFor(db)
    expect(await repo.listSuppliers({ search: 'bahati' })).toHaveLength(1)
    expect(await repo.listSuppliers({ search: '+254712000001' })).toHaveLength(2)
    expect(await repo.listSuppliers({ search: 'nothing here' })).toHaveLength(0)
  })

  it('refuses to remove a supplier that is still owed money', async () => {
    const repo = repositoryFor(db)
    await givenPurchase(db, {
      id: 'p1000000-0000-4000-8000-000000000002',
      supplierId: SUPPLIER.njoro,
      totalCents: 100_000,
    })

    await expect(repo.softDeleteSupplier(SUPPLIER.njoro)).rejects.toThrow(SupplierRuleError)
    await expect(repo.softDeleteSupplier(SUPPLIER.bahati)).resolves.toBeUndefined()
  })
})

describe('permissions (FR-7.5)', () => {
  it('lets an accountant read but never write', async () => {
    const repo = repositoryFor(db, 'accountant')

    expect(await repo.listSuppliers()).toHaveLength(2)
    await expect(
      repo.createSupplier({ id: crypto.randomUUID(), name: 'Blocked Farm' }),
    ).rejects.toThrow(SupplierRuleError)
  })

  it('lets an accountant record a supplier payment', async () => {
    const repo = repositoryFor(db, 'accountant')
    await givenPurchase(db, {
      id: 'p1000000-0000-4000-8000-000000000003',
      supplierId: SUPPLIER.njoro,
      status: 'received',
      totalCents: 90_000,
    })

    await repo.recordPayment({
      id: crypto.randomUUID(),
      purchaseId: 'p1000000-0000-4000-8000-000000000003',
      amountCents: 90_000,
      method: 'mpesa',
    })

    const purchase = await repo.findPurchase('p1000000-0000-4000-8000-000000000003')
    expect(purchase?.balanceCents).toBe(0)
  })
})

describe('purchases (FR-7.2)', () => {
  it('creates a purchase with lines and leaves numbering to the server (FR-5.1 rule)', async () => {
    const repo = repositoryFor(db)
    const id = crypto.randomUUID()

    const purchase = await repo.createPurchase({
      id,
      supplierId: SUPPLIER.njoro,
      purchaseDate: '2026-09-01',
      dueDate: '2026-10-01',
      lines: [
        { productId: PRODUCT.eucalyptus, quantity: 40, unitCostCents: 12_000 },
        { productId: PRODUCT.parvifolia, quantity: 10, unitCostCents: 14_000 },
      ],
    })

    expect(purchase.purchase_number).toBeNull()
    expect(purchase.total_cents).toBe(40 * 12_000 + 10 * 14_000)
    expect(purchase.itemCount).toBe(2)
    expect(purchase.status).toBe('ordered')

    const detail = await repo.purchaseDetail(id)
    expect(detail?.items.map((item) => item.quantity)).toEqual([40, 10])
  })

  it('rejects an empty or negative purchase', async () => {
    const repo = repositoryFor(db)
    await expect(
      repo.createPurchase({
        id: crypto.randomUUID(),
        supplierId: SUPPLIER.njoro,
        purchaseDate: '2026-09-01',
        lines: [],
      }),
    ).rejects.toThrow(/at least one line/i)

    await expect(
      repo.createPurchase({
        id: crypto.randomUUID(),
        supplierId: SUPPLIER.njoro,
        purchaseDate: '2026-09-01',
        lines: [{ productId: PRODUCT.eucalyptus, quantity: 0, unitCostCents: 100 }],
      }),
    ).rejects.toThrow(/quantity above zero/i)
  })

  it('queues every write for sync rather than sending it', async () => {
    const repo = repositoryFor(db)
    const id = crypto.randomUUID()
    await repo.createPurchase({
      id,
      supplierId: SUPPLIER.njoro,
      purchaseDate: '2026-09-01',
      lines: [{ productId: PRODUCT.eucalyptus, quantity: 5, unitCostCents: 12_000 }],
    })

    const queued = await db.select<{ entity_table: string }>(
      'SELECT entity_table FROM outbox ORDER BY seq',
    )
    expect(queued.map((row) => row.entity_table)).toEqual(['purchases', 'purchase_items'])
  })
})

describe('receipt moves stock, and only receipt (FR-7.3, FR-7.6)', () => {
  it('sets received_at on the transition and writes no movement locally', async () => {
    const repo = repositoryFor(db)
    const id = crypto.randomUUID()
    await repo.createPurchase({
      id,
      supplierId: SUPPLIER.njoro,
      purchaseDate: '2026-09-01',
      lines: [{ productId: PRODUCT.eucalyptus, quantity: 25, unitCostCents: 12_000 }],
    })

    expect((await repo.findPurchase(id))?.received_at).toBeNull()

    await repo.transition(id, 'received')
    const received = await repo.findPurchase(id)

    expect(received?.status).toBe('received')
    expect(received?.received_at).toBe(NOW)

    // The server trigger owns the movements. A device writing them too would
    // double-count once two devices received the same purchase offline.
    const movements = await db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM stock_movements WHERE source_id = ?',
      [id],
    )
    expect(Number(movements[0]?.n)).toBe(0)
  })

  it('runs the pipeline forward only', async () => {
    expect(nextPurchaseStatuses('ordered')).toEqual(['received'])
    expect(nextPurchaseStatuses('paid')).toEqual([])
    expect(canTransitionPurchase('received', 'ordered')).toBe(false)
    expect(canTransitionPurchase('ordered', 'paid')).toBe(false)

    const repo = repositoryFor(db)
    await givenPurchase(db, {
      id: 'p1000000-0000-4000-8000-000000000004',
      supplierId: SUPPLIER.njoro,
      status: 'received',
      totalCents: 1000,
    })

    await expect(
      repo.transition('p1000000-0000-4000-8000-000000000004', 'ordered'),
    ).rejects.toThrow(/only runs forward/i)
  })
})

describe('payables (FR-7.4)', () => {
  it('takes partial payments and closes the purchase on the last shilling', async () => {
    const repo = repositoryFor(db)
    await givenPurchase(db, {
      id: 'p1000000-0000-4000-8000-000000000005',
      supplierId: SUPPLIER.njoro,
      status: 'received',
      totalCents: 300_000,
    })

    await repo.recordPayment({
      id: crypto.randomUUID(),
      purchaseId: 'p1000000-0000-4000-8000-000000000005',
      amountCents: 100_000,
      method: 'mpesa',
    })
    let purchase = await repo.findPurchase('p1000000-0000-4000-8000-000000000005')
    expect(purchase?.balanceCents).toBe(200_000)
    expect(purchase?.status).toBe('received')

    await repo.recordPayment({
      id: crypto.randomUUID(),
      purchaseId: 'p1000000-0000-4000-8000-000000000005',
      amountCents: 200_000,
      method: 'bank_transfer',
    })
    purchase = await repo.findPurchase('p1000000-0000-4000-8000-000000000005')
    expect(purchase?.balanceCents).toBe(0)
    expect(purchase?.status).toBe('paid')
  })

  it('refuses to overpay a purchase', async () => {
    const repo = repositoryFor(db)
    await givenPurchase(db, {
      id: 'p1000000-0000-4000-8000-000000000006',
      supplierId: SUPPLIER.njoro,
      status: 'received',
      totalCents: 50_000,
    })

    await expect(
      repo.recordPayment({
        id: crypto.randomUUID(),
        purchaseId: 'p1000000-0000-4000-8000-000000000006',
        amountCents: 50_001,
        method: 'cash',
      }),
    ).rejects.toThrow(/more than/i)
  })

  it('ages what is owed into the PRD buckets', async () => {
    const repo = repositoryFor(db)
    // NOW is 2026-09-16.
    const cases: Array<[string, string, number]> = [
      ['p1000000-0000-4000-8000-000000000010', '2026-09-10', 100_000], // 6 days
      ['p1000000-0000-4000-8000-000000000011', '2026-08-10', 200_000], // 37 days
      ['p1000000-0000-4000-8000-000000000012', '2026-07-10', 300_000], // 68 days
      ['p1000000-0000-4000-8000-000000000013', '2026-01-10', 400_000], // 249 days
    ]
    for (const [id, dueDate, total] of cases) {
      await givenPurchase(db, {
        id,
        supplierId: SUPPLIER.njoro,
        status: 'received',
        dueDate,
        totalCents: total,
      })
    }

    const buckets = await repo.payablesAging()
    expect(buckets.map((bucket) => bucket.amountCents)).toEqual([
      100_000, 200_000, 300_000, 400_000,
    ])
    expect(await repo.totalPayableCents()).toBe(1_000_000)
  })

  it('excludes a fully paid purchase from the aging report', async () => {
    const repo = repositoryFor(db)
    await givenPurchase(db, {
      id: 'p1000000-0000-4000-8000-000000000014',
      supplierId: SUPPLIER.njoro,
      status: 'received',
      dueDate: '2026-01-01',
      totalCents: 80_000,
    })
    await givenSupplierPayment(db, {
      id: crypto.randomUUID(),
      purchaseId: 'p1000000-0000-4000-8000-000000000014',
      amountCents: 80_000,
    })

    expect(await repo.totalPayableCents()).toBe(0)
    const buckets = await repo.payablesAging()
    expect(buckets.every((bucket) => bucket.amountCents === 0)).toBe(true)
  })
})
