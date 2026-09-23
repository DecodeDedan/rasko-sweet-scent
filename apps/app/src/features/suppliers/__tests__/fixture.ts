import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { SuppliersRepository } from '../suppliersRepository.js'
import type { Role } from '../../../auth/session.js'

export const OWNER = '11111111-1111-4111-8111-111111111111'
export const ACCOUNTANT = '33333333-3333-4333-8333-333333333333'
export const SALES = '44444444-4444-4444-8444-444444444444'

export const CATEGORY = 'ca000000-0000-4000-8000-000000000001'
export const PRODUCT = {
  eucalyptus: '40000000-0000-4000-8000-000000000001',
  parvifolia: '40000000-0000-4000-8000-000000000002',
} as const

export const SUPPLIER = {
  njoro: '50000000-0000-4000-8000-000000000001',
  bahati: '50000000-0000-4000-8000-000000000002',
} as const

const TS = '2026-08-01T00:00:00.000Z'

/** Fixed so aging arithmetic in the tests is not a function of the wall clock. */
export const NOW = '2026-09-16T09:00:00.000Z'

export async function seededDatabase(): Promise<SqlDatabase> {
  const db = openNodeDatabase()
  await migrateLocalSchema(db)

  await db.execute(
    `INSERT INTO categories (id, name, slug, is_vatable, position, created_at, updated_at, sync_status)
     VALUES (?, 'Cut foliage', 'cut_foliage', 1, 1, ?, ?, 'synced')`,
    [CATEGORY, TS, TS],
  )

  const product = async (id: string, sku: string, name: string, cost: number) =>
    db.execute(
      `INSERT INTO products (id, sku, name, category_id, unit, cost_price_cents,
                             selling_price_cents, low_stock_threshold, is_active,
                             created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, 'bundle', ?, ?, ?, 1, ?, ?, 'synced')`,
      [id, sku, name, CATEGORY, cost, cost * 2, 10 * 1000, TS, TS],
    )

  await product(PRODUCT.eucalyptus, 'RSS-EUC-001', 'Eucalyptus Cinerea', 12000)
  await product(PRODUCT.parvifolia, 'RSS-EUC-002', 'Eucalyptus Parvifolia', 14000)

  const supplier = async (id: string, name: string, terms: number) =>
    db.execute(
      `INSERT INTO suppliers (id, name, contact_person, phone, payment_terms_days,
                              created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')`,
      [id, name, 'Contact', '+254712000001', terms, TS, TS],
    )

  await supplier(SUPPLIER.njoro, 'Njoro Highland Farm', 30)
  await supplier(SUPPLIER.bahati, 'Bahati Greens', 14)

  return db
}

export function repositoryFor(
  db: SqlDatabase,
  role: Role = 'owner',
  userId: string = OWNER,
): SuppliersRepository {
  return new SuppliersRepository(db, role, { userId }, () => NOW)
}

/** Inserts a purchase directly, bypassing role checks, to set up a scenario. */
export async function givenPurchase(
  db: SqlDatabase,
  purchase: {
    id: string
    supplierId: string
    status?: string
    purchaseDate?: string
    dueDate?: string | null
    totalCents: number
    number?: string | null
  },
): Promise<void> {
  await db.execute(
    `INSERT INTO purchases (id, purchase_number, supplier_id, status, purchase_date,
                            due_date, total_cents, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
    [
      purchase.id,
      purchase.number ?? null,
      purchase.supplierId,
      purchase.status ?? 'ordered',
      purchase.purchaseDate ?? '2026-08-01',
      purchase.dueDate ?? null,
      purchase.totalCents,
      TS,
      TS,
    ],
  )
}

export async function givenSupplierPayment(
  db: SqlDatabase,
  payment: { id: string; purchaseId: string; amountCents: number; paidAt?: string },
): Promise<void> {
  await db.execute(
    `INSERT INTO supplier_payments (id, purchase_id, amount_cents, method, paid_at,
                                    created_at, sync_status)
     VALUES (?, ?, ?, 'mpesa', ?, ?, 'synced')`,
    [payment.id, payment.purchaseId, payment.amountCents, payment.paidAt ?? TS, TS],
  )
}
