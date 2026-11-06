import type { SqlDatabase } from './types.js'

/**
 * Clears the local copy after the server has confirmed the destructive purge.
 * Outbox rows and cursors must go too, otherwise deleted test data could be
 * pushed back or remain hidden behind an old cursor.
 */
const BUSINESS_TABLES = [
  'payroll_payouts',
  'supplier_payments',
  'reversals',
  'payments',
  'payroll_items',
  'advances',
  'purchase_items',
  'purchases',
  'order_items',
  'invoices',
  'stock_movements',
  'products',
  'product_prices',
  'orders',
  'suppliers',
  'employees',
  'payroll_runs',
  'clients',
  'categories',
  'outbound_emails',
  'email_templates',
] as const

export async function purgeLocalBusinessData(db: SqlDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of BUSINESS_TABLES) {
      await tx.execute(`DELETE FROM ${table}`)
    }
    await tx.execute('DELETE FROM outbox')
    await tx.execute('DELETE FROM outbox_dead')
    await tx.execute('DELETE FROM sync_state')
  })
}
