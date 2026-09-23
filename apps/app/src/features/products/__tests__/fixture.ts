import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'

export const OWNER = '11111111-1111-4111-8111-111111111111'
export const MANAGER = '22222222-2222-4222-8222-222222222222'
export const SALES = '44444444-4444-4444-8444-444444444444'
export const CATEGORY = 'ca000000-0000-4000-8000-000000000001'

export const PRODUCT = {
  rose: '40000000-0000-4000-8000-000000000001',
  gyp: '40000000-0000-4000-8000-000000000003',
  vase: '40000000-0000-4000-8000-000000000006',
  /** No movements at all, so stock is zero and it counts as low. */
  fresh: '40000000-0000-4000-8000-000000000009',
} as const

const TS = '2026-08-01T00:00:00.000Z'

export async function seededDatabase(): Promise<SqlDatabase> {
  const db = openNodeDatabase()
  await migrateLocalSchema(db)

  await db.execute(
    `INSERT INTO categories (id, name, slug, is_vatable, position, created_at, updated_at, sync_status)
     VALUES (?, 'Fresh flowers', 'fresh_flowers', 1, 1, ?, ?, 'synced')`,
    [CATEGORY, TS, TS],
  )

  const product = async (
    id: string,
    sku: string,
    name: string,
    unit: string,
    cost: number,
    sell: number,
    threshold: number,
  ) =>
    db.execute(
      `INSERT INTO products (id, sku, name, category_id, unit, cost_price_cents,
                             selling_price_cents, low_stock_threshold, is_active,
                             created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'synced')`,
      // low_stock_threshold is a qty column: stored as thousandths.
      [id, sku, name, CATEGORY, unit, cost, sell, threshold * 1000, TS, TS],
    )

  await product(PRODUCT.rose, 'RSS-ROS-001', 'Red Naomi Rose', 'stem', 2500, 6000, 200)
  await product(PRODUCT.gyp, 'RSS-GYP-001', 'Gypsophila', 'bundle', 15000, 35000, 10)
  await product(PRODUCT.vase, 'RSS-VAS-001', 'Ceramic Vase, medium', 'piece', 80000, 180000, 5)
  await product(PRODUCT.fresh, 'RSS-NEW-001', 'Oriental Lily', 'stem', 4000, 9000, 50)

  const movement = async (
    id: string,
    productId: string,
    type: string,
    quantity: number,
    when: string,
    reason: string | null = null,
    cost: number | null = null,
    sourceTable = 'manual',
    sourceId: string | null = null,
  ) =>
    db.execute(
      `INSERT INTO stock_movements (id, product_id, movement_type, quantity, unit_cost_cents,
                                    source_table, source_id, reason, occurred_at,
                                    created_at, created_by, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
      [
        id,
        productId,
        type,
        quantity * 1000,
        cost,
        sourceTable,
        sourceId,
        reason,
        when,
        when,
        OWNER,
      ],
    )

  // Roses: 1000 in, 160 sold, 140 wasted -> 700
  await movement(
    '63000000-0000-4000-8000-000000000001',
    PRODUCT.rose,
    'purchase_in',
    1000,
    '2026-08-26T06:00:00.000Z',
    null,
    2500,
    'purchases',
    '60000000-0000-4000-8000-000000000001',
  )
  await movement(
    '63000000-0000-4000-8000-000000000002',
    PRODUCT.rose,
    'sale',
    -160,
    '2026-08-30T08:00:00.000Z',
    null,
    2500,
    'orders',
    '70000000-0000-4000-8000-000000000003',
  )
  await movement(
    '63000000-0000-4000-8000-000000000003',
    PRODUCT.rose,
    'wastage',
    -140,
    '2026-08-31T05:30:00.000Z',
    'Heat damage in transit',
    2500,
  )

  // Gypsophila: 40 in, 12 wasted -> 28
  await movement(
    '63000000-0000-4000-8000-000000000004',
    PRODUCT.gyp,
    'purchase_in',
    40,
    '2026-08-28T06:30:00.000Z',
    null,
    15000,
    'purchases',
    '60000000-0000-4000-8000-000000000002',
  )
  await movement(
    '63000000-0000-4000-8000-000000000005',
    PRODUCT.gyp,
    'wastage',
    -12,
    '2026-08-31T05:00:00.000Z',
    'Wilted, past usable life',
    15000,
  )

  // Vases: 3 in, 5 sold -> -2, which FR-6.7 allows and flags.
  await movement(
    '63000000-0000-4000-8000-000000000006',
    PRODUCT.vase,
    'purchase_in',
    3,
    '2026-08-25T09:00:00.000Z',
    null,
    80000,
  )
  await movement(
    '63000000-0000-4000-8000-000000000007',
    PRODUCT.vase,
    'sale',
    -5,
    '2026-08-31T15:00:00.000Z',
    null,
    80000,
    'orders',
    '70000000-0000-4000-8000-000000000004',
  )

  return db
}
