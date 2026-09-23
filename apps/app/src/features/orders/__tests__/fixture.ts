import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'

export const OWNER = '11111111-1111-4111-8111-111111111111'
export const MANAGER = '22222222-2222-4222-8222-222222222222'
export const SALES = '44444444-4444-4444-8444-444444444444'
export const OTHER_SALES = '55555555-5555-4555-8555-555555555555'

export const CLIENT = 'c0000000-0000-4000-8000-000000000002'
export const PRODUCT_ROSE = '40000000-0000-4000-8000-000000000001'
export const PRODUCT_GYP = '40000000-0000-4000-8000-000000000003'

/** Order ids by the status they are seeded in, so tests read plainly. */
export const ORDER = {
  draftBySales: '70000000-0000-4000-8000-000000000001',
  draftByOtherSales: '70000000-0000-4000-8000-000000000002',
  confirmed: '70000000-0000-4000-8000-000000000003',
  inProduction: '70000000-0000-4000-8000-000000000004',
  delivered: '70000000-0000-4000-8000-000000000005',
  closed: '70000000-0000-4000-8000-000000000006',
  cancelled: '70000000-0000-4000-8000-000000000007',
} as const

export async function seededDatabase(): Promise<SqlDatabase> {
  const db = openNodeDatabase()
  await migrateLocalSchema(db)

  // VAT off by default, matching the seeded business (PRD §12.3 recommendation).
  await db.execute(
    `INSERT INTO tax_config (id, is_vat_enabled, vat_rate_bp, effective_from,
                             applies_to_category_ids, created_at, updated_at, sync_status)
     VALUES ('7a000000-0000-4000-8000-000000000001', 0, 1600, '2026-01-01', '[]',
             '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'synced')`,
  )

  await db.execute(
    `INSERT INTO categories (id, name, slug, is_vatable, position, created_at, updated_at, sync_status)
     VALUES ('ca000000-0000-4000-8000-000000000001', 'Fresh flowers', 'fresh_flowers', 1, 1,
             '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'synced')`,
  )

  await db.execute(
    `INSERT INTO clients (id, name, client_type, credit_terms_days, created_at, updated_at, sync_status)
     VALUES (?, 'Menengai Events & Planning', 'event_planner', 30,
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'synced')`,
    [CLIENT],
  )

  const product = async (id: string, sku: string, name: string, unit: string, price: number) =>
    db.execute(
      `INSERT INTO products (id, sku, name, unit, category_id, selling_price_cents, is_active,
                             created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, 'ca000000-0000-4000-8000-000000000001', ?, 1,
               '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'synced')`,
      [id, sku, name, unit, price],
    )
  await product(PRODUCT_ROSE, 'RSS-ROS-001', 'Red Naomi Rose', 'stem', 6000)
  await product(PRODUCT_GYP, 'RSS-GYP-001', 'Gypsophila', 'bundle', 35000)

  const order = async (id: string, status: string, createdBy: string, deliveryAt: string | null) =>
    db.execute(
      `INSERT INTO orders (id, client_id, is_walk_in, status, order_type, subtotal_cents,
                           discount_cents, total_cents, delivery_at, taken_by, created_by,
                           created_at, updated_at, sync_status)
       VALUES (?, ?, 0, ?, 'standard', 100000, 0, 100000, ?, ?, ?,
               '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', 'synced')`,
      [id, CLIENT, status, deliveryAt, createdBy, createdBy],
    )

  await order(ORDER.draftBySales, 'draft', SALES, '2026-09-05T08:00:00.000Z')
  await order(ORDER.draftByOtherSales, 'draft', OTHER_SALES, '2026-09-06T08:00:00.000Z')
  await order(ORDER.confirmed, 'confirmed', MANAGER, '2026-09-03T09:00:00.000Z')
  await order(ORDER.inProduction, 'in_production', MANAGER, '2026-09-03T11:00:00.000Z')
  await order(ORDER.delivered, 'delivered', MANAGER, '2026-08-30T11:00:00.000Z')
  await order(ORDER.closed, 'closed', MANAGER, '2026-08-29T11:00:00.000Z')
  await order(ORDER.cancelled, 'cancelled', MANAGER, null)

  await db.execute(
    `INSERT INTO order_items (id, order_id, product_id, description, quantity,
                              unit_price_cents, discount_cents, line_total_cents, position,
                              created_at, updated_at, sync_status)
     VALUES ('71000000-0000-4000-8000-000000000001', ?, ?, 'Red Naomi Rose',
             20000, 6000, 0, 120000, 1,
             '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', 'synced')`,
    [ORDER.confirmed, PRODUCT_ROSE],
  )

  return db
}
