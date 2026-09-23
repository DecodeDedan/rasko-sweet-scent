import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'

/**
 * The subset of `supabase/seed.sql` that the balance arithmetic depends on,
 * inserted straight into the local mirror as though it had been pulled.
 *
 * Ids and amounts are copied from the seed so the figures in balances.test.ts
 * can be compared against what the Postgres views actually produce.
 */

export const OWNER = '11111111-1111-4111-8111-111111111111'
export const MANAGER = '22222222-2222-4222-8222-222222222222'
export const SALES = '44444444-4444-4444-8444-444444444444'

export const CLIENT = {
  lanet: 'c0000000-0000-4000-8000-000000000001',
  menengai: 'c0000000-0000-4000-8000-000000000002',
  riftValley: 'c0000000-0000-4000-8000-000000000003',
  grace: 'c0000000-0000-4000-8000-000000000004',
  peter: 'c0000000-0000-4000-8000-000000000005',
  mercy: 'c0000000-0000-4000-8000-000000000006',
} as const

export async function seededDatabase(): Promise<SqlDatabase> {
  const db = openNodeDatabase()
  await migrateLocalSchema(db)

  const client = async (
    id: string,
    name: string,
    type: string,
    phone: string,
    createdBy: string,
    terms = 0,
  ) => {
    await db.execute(
      `INSERT INTO clients (id, name, client_type, phone, credit_terms_days, created_by,
                            created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'synced')`,
      [id, name, type, phone, terms, createdBy],
    )
  }

  await client(CLIENT.lanet, 'Lanet Gardens Hotel', 'corporate', '+254712004518', MANAGER, 30)
  await client(
    CLIENT.menengai,
    'Menengai Events & Planning',
    'event_planner',
    '+254733901224',
    MANAGER,
    30,
  )
  await client(CLIENT.riftValley, 'Rift Valley Sports Club', 'corporate', '+254720443119', OWNER, 7)
  await client(CLIENT.grace, 'Grace Wanjiru Kamau', 'individual', '+254722187340', OWNER)
  // The two the SALES user created — the FR-3.4 scope case.
  await client(CLIENT.peter, 'Peter Otieno Ochieng', 'individual', '+254701556082', SALES)
  await client(CLIENT.mercy, 'Mercy Chebet Kiplagat', 'individual', '+254745620371', SALES)

  const invoice = async (
    id: string,
    clientId: string,
    number: string | null,
    status: string,
    total: number,
    issue: string,
    due: string,
  ) => {
    await db.execute(
      `INSERT INTO invoices (id, client_id, invoice_number, status, issue_date, due_date,
                             total_cents, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'synced')`,
      [id, clientId, number, status, issue, due, total],
    )
  }

  await invoice(
    '80000000-0000-4000-8000-000000000001',
    CLIENT.menengai,
    'INV-2026-0001',
    'issued',
    12750000,
    '2026-08-31',
    '2026-09-30',
  )
  await invoice(
    '80000000-0000-4000-8000-000000000002',
    CLIENT.lanet,
    'INV-2026-0002',
    'issued',
    6850000,
    '2026-08-28',
    '2026-09-27',
  )
  await invoice(
    '80000000-0000-4000-8000-000000000003',
    CLIENT.riftValley,
    'INV-2026-0003',
    'issued',
    3400000,
    '2026-08-19',
    '2026-08-26',
  )
  await invoice(
    '80000000-0000-4000-8000-000000000004',
    CLIENT.peter,
    'INV-2026-0004',
    'issued',
    320000,
    '2026-07-24',
    '2026-08-08',
  )
  // Draft: not owed, so it must not appear in either figure.
  await invoice(
    '80000000-0000-4000-8000-000000000005',
    CLIENT.mercy,
    null,
    'draft',
    185000,
    '2026-09-01',
    '2026-09-01',
  )

  const payment = async (id: string, invoiceId: string, amount: number, method: string) => {
    await db.execute(
      `INSERT INTO payments (id, invoice_id, amount_cents, method, paid_at, received_by,
                             created_at, sync_status)
       VALUES (?, ?, ?, ?, '2026-08-26T11:05:00.000Z', ?, '2026-08-26T11:05:00.000Z', 'synced')`,
      [id, invoiceId, amount, method, OWNER],
    )
  }

  await payment(
    '90000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000003',
    2000000,
    'mpesa',
  )
  await payment(
    '90000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000003',
    1400000,
    'bank_transfer',
  )
  await payment(
    '90000000-0000-4000-8000-000000000003',
    '80000000-0000-4000-8000-000000000002',
    2000000,
    'mpesa',
  )
  // Recorded twice by mistake, then reversed.
  await payment(
    '90000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000002',
    150000,
    'cash',
  )

  await db.execute(
    `INSERT INTO reversals (id, payment_id, amount_cents, reason, reversed_at, created_at, sync_status)
     VALUES ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004',
             150000, 'Duplicate entry', '2026-08-30T09:40:00.000Z', '2026-08-30T09:40:00.000Z', 'synced')`,
  )

  await db.execute(
    `INSERT INTO orders (id, client_id, status, taken_by, total_cents, delivery_at,
                         created_at, updated_at, sync_status)
     VALUES ('70000000-0000-4000-8000-000000000001', ?, 'in_production', ?, 8640000,
             '2026-09-03T09:00:00.000Z', '2026-08-31T06:00:00.000Z', '2026-08-31T06:00:00.000Z', 'synced')`,
    [CLIENT.menengai, MANAGER],
  )

  return db
}
