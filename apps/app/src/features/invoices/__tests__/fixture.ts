import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'

export const OWNER = '11111111-1111-4111-8111-111111111111'
export const MANAGER = '22222222-2222-4222-8222-222222222222'
export const SALES = '44444444-4444-4444-8444-444444444444'
export const CLIENT = 'c0000000-0000-4000-8000-000000000001'

export const INVOICE = {
  draft: '80000000-0000-4000-8000-000000000001',
  /** Issued, nothing paid, due in the future. */
  unpaid: '80000000-0000-4000-8000-000000000002',
  /** Issued, due in the past. */
  overdue: '80000000-0000-4000-8000-000000000003',
} as const

/** Fixed "today" so the overdue arithmetic is deterministic. */
export const TODAY = new Date('2026-09-04T09:00:00.000Z')

export async function seededDatabase(): Promise<SqlDatabase> {
  const db = openNodeDatabase()
  await migrateLocalSchema(db)

  await db.execute(
    `INSERT INTO company_settings (id, company_name, address, phone, email, kra_pin,
                                   mpesa_paybill, bank_details, is_vat_registered,
                                   created_at, updated_at, sync_status)
     VALUES ('00000000-0000-0000-0000-000000000001', 'Rasko Sweet Scent',
             'Kenyatta Avenue, Nakuru', '+254712004500', 'hello@raskosweetscent.example',
             'A000000001X', '400200', '{"bank":"Demo Bank","account":"0123456789"}', 0,
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'synced')`,
  )

  await db.execute(
    `INSERT INTO clients (id, name, client_type, phone, email, credit_terms_days,
                          created_at, updated_at, sync_status)
     VALUES (?, 'Lanet Gardens Hotel', 'corporate', '+254712004518',
             'events@lanetgardens.example', 30,
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'synced')`,
    [CLIENT],
  )

  const invoice = async (
    id: string,
    number: string | null,
    status: string,
    total: number,
    issue: string,
    due: string,
  ) =>
    db.execute(
      `INSERT INTO invoices (id, client_id, invoice_number, status, issue_date, due_date,
                             subtotal_cents, total_cents, client_snapshot, company_snapshot,
                             created_by, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{"name":"Lanet Gardens Hotel"}', '{}', ?,
               '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'synced')`,
      [id, CLIENT, number, status, issue, due, total, total, OWNER],
    )

  await invoice(INVOICE.draft, null, 'draft', 500000, '2026-09-04', '2026-10-04')
  await invoice(INVOICE.unpaid, 'INV-2026-0001', 'issued', 1000000, '2026-09-01', '2026-10-01')
  await invoice(INVOICE.overdue, 'INV-2026-0002', 'issued', 320000, '2026-07-24', '2026-08-08')

  return db
}
