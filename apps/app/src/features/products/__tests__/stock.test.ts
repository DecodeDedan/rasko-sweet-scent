import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { suggestName, suggestSku } from '../ProductForm.js'
import { ProductRuleError, ProductsRepository } from '../productsRepository.js'
import { pendingCount } from '../../../data/sync/outbox.js'
import { CATEGORY, MANAGER, OWNER, PRODUCT, SALES, seededDatabase } from './fixture.js'

describe('stock derived from movements', () => {
  let db: SqlDatabase
  let asOwner: ProductsRepository
  let asSales: ProductsRepository

  beforeEach(async () => {
    db = await seededDatabase()
    asOwner = new ProductsRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER })
    asSales = new ProductsRepository(db, { role: 'sales', userId: SALES }, { userId: SALES })
  })

  afterEach(async () => {
    await db.close()
  })

  // ------------------------------------------------------ FR-6.2 stock math

  it('sums the ledger rather than reading a stored column', async () => {
    const products = await asOwner.list()
    const byId = Object.fromEntries(products.map((p) => [p.id, p]))

    // 1000 in, 160 sold, 140 wasted.
    expect(byId[PRODUCT.rose]?.currentStock).toBe(700)
    // 40 in, 12 wasted.
    expect(byId[PRODUCT.gyp]?.currentStock).toBe(28)
    // 3 in, 5 sold.
    expect(byId[PRODUCT.vase]?.currentStock).toBe(-2)
    // No movements at all.
    expect(byId[PRODUCT.fresh]?.currentStock).toBe(0)
  })

  it('has no current_stock column to write to', async () => {
    const columns = await db.select<{ name: string }>('PRAGMA table_info(products)')
    expect(columns.map((c) => c.name)).not.toContain('current_stock')
  })

  it('moves stock only by appending to the ledger', async () => {
    const before = (await asOwner.findStock(PRODUCT.gyp))?.currentStock
    expect(before).toBe(28)

    await asOwner.recordMovement({
      id: 'aa000000-0000-4000-8000-000000000001',
      productId: PRODUCT.gyp,
      type: 'purchase_in',
      quantity: 20,
      reason: null,
    })

    expect((await asOwner.findStock(PRODUCT.gyp))?.currentStock).toBe(48)
    const ledger = await asOwner.movementLedger({ productId: PRODUCT.gyp })
    expect(ledger[0]).toMatchObject({ movement_type: 'purchase_in', quantity: 20 })
  })

  it('applies the sign from the movement type, whatever the user typed', async () => {
    // Wastage entered as a positive magnitude still reduces stock.
    await asOwner.recordMovement({
      id: 'aa000000-0000-4000-8000-000000000002',
      productId: PRODUCT.rose,
      type: 'wastage',
      quantity: 50,
      reason: 'Dropped a bucket',
    })
    expect((await asOwner.findStock(PRODUCT.rose))?.currentStock).toBe(650)

    // A return adds back.
    await asOwner.recordMovement({
      id: 'aa000000-0000-4000-8000-000000000003',
      productId: PRODUCT.rose,
      type: 'return',
      quantity: 10,
      reason: null,
    })
    expect((await asOwner.findStock(PRODUCT.rose))?.currentStock).toBe(660)
  })

  it('lets an adjustment go either way', async () => {
    await asOwner.recordMovement({
      id: 'aa000000-0000-4000-8000-000000000004',
      productId: PRODUCT.gyp,
      type: 'adjustment',
      quantity: -3,
      reason: 'Stock count 31/08',
    })
    expect((await asOwner.findStock(PRODUCT.gyp))?.currentStock).toBe(25)

    await asOwner.recordMovement({
      id: 'aa000000-0000-4000-8000-000000000005',
      productId: PRODUCT.gyp,
      type: 'adjustment',
      quantity: 5,
      reason: 'Found a crate in the back',
    })
    expect((await asOwner.findStock(PRODUCT.gyp))?.currentStock).toBe(30)
  })

  it('keeps fractional quantities exact across many movements', async () => {
    // Quantities are stored as thousandths precisely so repeated summation does
    // not drift the way binary floating point would.
    for (let i = 0; i < 30; i += 1) {
      await asOwner.recordMovement({
        id: `ab000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        productId: PRODUCT.fresh,
        type: 'purchase_in',
        quantity: 0.1,
        reason: null,
      })
    }
    expect((await asOwner.findStock(PRODUCT.fresh))?.currentStock).toBe(3)
  })

  // -------------------------------------------------- FR-6.2 reason required

  it('requires a reason for wastage and adjustment, and not for the others', async () => {
    await expect(
      asOwner.recordMovement({
        id: 'ac000000-0000-4000-8000-000000000001',
        productId: PRODUCT.rose,
        type: 'wastage',
        quantity: 5,
        reason: '  ',
      }),
    ).rejects.toThrow(/give a reason/i)

    await expect(
      asOwner.recordMovement({
        id: 'ac000000-0000-4000-8000-000000000002',
        productId: PRODUCT.rose,
        type: 'adjustment',
        quantity: 5,
        reason: null,
      }),
    ).rejects.toThrow(/give a reason/i)

    // purchase_in needs none.
    await expect(
      asOwner.recordMovement({
        id: 'ac000000-0000-4000-8000-000000000003',
        productId: PRODUCT.rose,
        type: 'purchase_in',
        quantity: 5,
        reason: null,
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses a hand-written sale, so the ledger always names the order', async () => {
    await expect(
      asOwner.recordMovement({
        id: 'ac000000-0000-4000-8000-000000000004',
        productId: PRODUCT.rose,
        type: 'sale',
        quantity: 5,
        reason: null,
      }),
    ).rejects.toThrow(/recorded by the order/i)
  })

  it('refuses a zero quantity', async () => {
    await expect(
      asOwner.recordMovement({
        id: 'ac000000-0000-4000-8000-000000000005',
        productId: PRODUCT.rose,
        type: 'purchase_in',
        quantity: 0,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(ProductRuleError)
  })

  // ------------------------------------------------------- FR-6.4 / FR-6.7

  it("flags low stock against each product's own threshold", async () => {
    const low = await asOwner.lowStock()
    const ids = low.map((p) => p.id)

    // Vases: -2 against a threshold of 5. Lily: 0 against 50.
    expect(ids).toContain(PRODUCT.vase)
    expect(ids).toContain(PRODUCT.fresh)
    // Roses at 700 against 200, gypsophila at 28 against 10.
    expect(ids).not.toContain(PRODUCT.rose)
    expect(ids).not.toContain(PRODUCT.gyp)

    // Worst first, so the buyer sees what to fix.
    expect(low[0]?.id).toBe(PRODUCT.vase)
  })

  it('allows negative stock and flags it rather than blocking the sale', async () => {
    const vase = await asOwner.findStock(PRODUCT.vase)
    expect(vase?.currentStock).toBe(-2)
    expect(vase?.isNegative).toBe(true)
    expect(vase?.isLowStock).toBe(true)
  })

  // ---------------------------------------------------------- FR-6.5 wastage

  it('reports wastage by product with its cost', async () => {
    const report = await asOwner.wastageReport(
      '2026-08-01T00:00:00.000Z',
      '2026-09-30T00:00:00.000Z',
    )

    const roses = report.find((r) => r.productId === PRODUCT.rose)
    expect(roses).toMatchObject({ quantity: 140, occurrences: 1 })
    // 140 stems at 2,500 cents.
    expect(roses?.costCents).toBe(350000)

    const gyp = report.find((r) => r.productId === PRODUCT.gyp)
    expect(gyp?.costCents).toBe(180000) // 12 bundles at 15,000

    // Costliest first.
    expect(report[0]?.productId).toBe(PRODUCT.rose)
  })

  it('limits the wastage report to its period', async () => {
    const narrow = await asOwner.wastageReport(
      '2026-08-31T05:15:00.000Z',
      '2026-08-31T23:59:00.000Z',
    )
    // Only the rose wastage at 05:30 falls inside.
    expect(narrow.map((r) => r.productId)).toEqual([PRODUCT.rose])
  })

  // -------------------------------------------------------- FR-6.8 valuation

  it('values stock at cost and excludes products holding none', async () => {
    const { products, totalCents } = await asOwner.valuation()

    const roses = products.find((p) => p.id === PRODUCT.rose)
    expect(roses?.valuationCents).toBe(700 * 2500)

    // Negative stock carries a negative valuation rather than being hidden.
    expect(products.find((p) => p.id === PRODUCT.vase)?.valuationCents).toBe(-2 * 80000)
    // The lily holds nothing, so it is not in the valuation.
    expect(products.map((p) => p.id)).not.toContain(PRODUCT.fresh)

    expect(totalCents).toBe(700 * 2500 + 28 * 15000 + -2 * 80000)
  })

  // ------------------------------------------------------------- permissions

  it('lets accountant and sales look but not touch (PRD 3.1)', async () => {
    // Reading is fine.
    expect((await asSales.list()).length).toBeGreaterThan(0)

    await expect(
      asSales.recordMovement({
        id: 'ad000000-0000-4000-8000-000000000001',
        productId: PRODUCT.rose,
        type: 'wastage',
        quantity: 1,
        reason: 'test',
      }),
    ).rejects.toThrow(/only a manager or the owner/i)

    await expect(asSales.updateProduct(PRODUCT.rose, { selling_price_cents: 1 })).rejects.toThrow(
      /only a manager or the owner/i,
    )
  })

  // -------------------------------------------------------------- FR-6.1 CRUD

  it('refuses a duplicate SKU', async () => {
    const manager = new ProductsRepository(
      db,
      { role: 'manager', userId: MANAGER },
      { userId: MANAGER },
    )
    await expect(
      manager.createProduct({
        id: 'ae000000-0000-4000-8000-000000000001',
        sku: 'rss-ros-001',
        name: 'Duplicate rose',
        category_id: 'ca000000-0000-4000-8000-000000000001',
        stem_form: 'standard',
        unit: 'stem',
        cost_price_cents: 1,
        selling_price_cents: 2,
        low_stock_threshold: 0,
        is_active: true,
      }),
    ).rejects.toThrow(/already in use/i)
  })
})

describe('categories (FR-6.1)', () => {
  let db: SqlDatabase
  let manager: ProductsRepository

  beforeEach(async () => {
    db = await seededDatabase()
    manager = new ProductsRepository(db, { role: 'manager', userId: MANAGER }, { userId: MANAGER })
  })

  afterEach(async () => {
    await db.close()
  })

  it('creates a category locally and queues it for sync', async () => {
    const before = await pendingCount(db)
    await manager.createCategory('cb000000-0000-4000-8000-000000000001', '  Baby Blue  ')

    const names = (await manager.categories()).map((c) => c.name)
    expect(names).toContain('Baby Blue')
    expect(await pendingCount(db)).toBe(before + 1)
  })

  it('refuses a name already in use, ignoring case', async () => {
    await expect(
      manager.createCategory('cb000000-0000-4000-8000-000000000002', 'fresh FLOWERS'),
    ).rejects.toThrow(/already a variety/i)
  })

  it('refuses to remove a category that products still use', async () => {
    await expect(manager.removeCategory(CATEGORY)).rejects.toThrow(/4 products still use/)
  })

  it('removes an unused category', async () => {
    const id = 'cb000000-0000-4000-8000-000000000003'
    await manager.createCategory(id, 'Gunni')
    await manager.removeCategory(id)
    expect((await manager.categories()).map((c) => c.id)).not.toContain(id)
  })

  it('refuses category changes for sales (PRD §3.1: view only)', async () => {
    const sales = new ProductsRepository(db, { role: 'sales', userId: SALES }, { userId: SALES })
    await expect(
      sales.createCategory('cb000000-0000-4000-8000-000000000004', 'Gunni'),
    ).rejects.toBeInstanceOf(ProductRuleError)
  })

  it('refuses a product without a variety', async () => {
    await expect(
      manager.createProduct({
        id: 'ae000000-0000-4000-8000-000000000009',
        sku: 'RSS-BB-001',
        name: 'Baby Blue, 60cm',
        category_id: '',
        stem_form: 'standard',
        unit: 'stem',
        cost_price_cents: 1,
        selling_price_cents: 2,
        low_stock_threshold: 0,
        is_active: true,
      }),
    ).rejects.toThrow(/choose a variety/i)
  })
})

describe('standard and spray (migration 20260926000100)', () => {
  it('suggests a name and SKU from the variety and form', () => {
    expect(suggestSku('Baby Blue', 'spray')).toBe('BB-SPR')
    expect(suggestSku('Gunni', 'standard')).toBe('GUN-STD')
    expect(suggestName('Parvifolia', 'spray')).toBe('Parvifolia spray')
  })

  it('refuses a product that is neither standard nor spray', async () => {
    const db = await seededDatabase()
    const manager = new ProductsRepository(
      db,
      { role: 'manager', userId: MANAGER },
      { userId: MANAGER },
    )
    await expect(
      manager.createProduct({
        id: 'ae000000-0000-4000-8000-000000000010',
        sku: 'BB-XXX',
        name: 'Baby Blue',
        category_id: CATEGORY,
        stem_form: null,
        unit: 'stem',
        cost_price_cents: 1,
        selling_price_cents: 2,
        low_stock_threshold: 0,
        is_active: true,
      }),
    ).rejects.toThrow(/standard or spray/)
    await db.close()
  })

  it('filters the catalogue by form', async () => {
    const db = await seededDatabase()
    const manager = new ProductsRepository(
      db,
      { role: 'manager', userId: MANAGER },
      { userId: MANAGER },
    )
    await manager.createProduct({
      id: 'ae000000-0000-4000-8000-000000000011',
      sku: 'BB-SPR',
      name: 'Baby Blue spray',
      category_id: CATEGORY,
      stem_form: 'spray',
      unit: 'stem',
      cost_price_cents: 1,
      selling_price_cents: 2,
      low_stock_threshold: 0,
      is_active: true,
    })
    const sprays = await manager.list({ stemForm: 'spray' })
    expect(sprays.map((p) => p.sku)).toEqual(['BB-SPR'])
    expect(sprays[0]?.stem_form).toBe('spray')
    await db.close()
  })
})
