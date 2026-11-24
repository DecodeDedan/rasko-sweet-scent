import { beforeEach, describe, expect, it } from 'vitest'

import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { ClientsRepository } from '../../clients/clientsRepository.js'
import { StatementRepository } from '../statementRepository.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const TS = '2026-09-01T00:00:00.000Z'

async function seeded(): Promise<SqlDatabase> {
  const db = openNodeDatabase()
  await migrateLocalSchema(db)
  await db.execute(
    `INSERT INTO clients (id, name, client_type, phone, created_by, created_at, updated_at, sync_status)
     VALUES (?, 'Flora Holland Buyer', 'corporate', '+31201234567', ?, ?, ?, 'synced')`,
    [CLIENT, OWNER, TS, TS],
  )
  const invoice = (
    id: string,
    number: string,
    status: string,
    issued: string,
    due: string,
    total: number,
    currency: string,
  ) =>
    db.execute(
      `INSERT INTO invoices (id, invoice_number, client_id, status, issue_date, due_date,
                             total_cents, currency, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
      [id, number, CLIENT, status, issued, due, total, currency, TS, TS],
    )
  await invoice('i1', 'INV-2026-0010', 'issued', '2026-09-20', '2026-10-20', 1_000_000, 'KES')
  await invoice('i2', 'INV-2026-0011', 'issued', '2026-10-05', '2026-11-04', 600_000, 'KES')
  await invoice('i3', 'INV-2026-0012', 'draft', '2026-10-06', '2026-11-05', 999_999, 'KES')
  await invoice('i4', 'INV-2026-0013', 'issued', '2026-10-07', '2026-11-06', 250_000, 'USD')

  const payment = (id: string, invoiceId: string, amount: number, at: string) =>
    db.execute(
      `INSERT INTO payments (id, invoice_id, amount_cents, method, reference, paid_at, created_at, sync_status)
       VALUES (?, ?, ?, 'bank_transfer', ?, ?, ?, 'synced')`,
      [id, invoiceId, amount, `REF-${id}`, at, at],
    )
  await payment('p1', 'i1', 400_000, '2026-09-30T10:00:00.000Z')
  await payment('p2', 'i1', 300_000, '2026-10-10T10:00:00.000Z')
  await db.execute(
    `INSERT INTO reversals (id, payment_id, amount_cents, reason, reversed_at, created_at, sync_status)
     VALUES ('r1', 'p2', 100000, 'Bounced', '2026-10-12T10:00:00.000Z', ?, 'synced')`,
    [TS],
  )
  return db
}

describe('statement of account', () => {
  let db: SqlDatabase
  let repo: StatementRepository

  beforeEach(async () => {
    db = await seeded()
    repo = new StatementRepository(db, 'accountant')
  })

  it('opens with the balance brought forward and runs through the period', async () => {
    const set = await repo.statement(CLIENT, '2026-10-01', '2026-10-31')
    const kes = set.statements.find((s) => s.currency === 'KES')!

    expect(kes.opening_cents).toBe(600_000)
    expect(
      kes.lines.map((l) => [l.date, l.kind, l.debit_cents, l.credit_cents, l.balance_cents]),
    ).toEqual([
      ['2026-10-05', 'invoice', 600_000, 0, 1_200_000],
      ['2026-10-10', 'payment', 0, 300_000, 900_000],
      ['2026-10-12', 'reversal', 100_000, 0, 1_000_000],
    ])
    expect(kes.closing_cents).toBe(1_000_000)
  })

  it('keeps each currency on its own statement and ignores drafts', async () => {
    const set = await repo.statement(CLIENT, '2026-10-01', '2026-10-31')
    expect(set.statements.map((s) => [s.currency, s.closing_cents])).toEqual([
      ['KES', 1_000_000],
      ['USD', 250_000],
    ])
  })

  it('closes at the same figure the client balance shows', async () => {
    const set = await repo.statement(CLIENT, '2026-01-01', '2026-12-31')
    const clients = new ClientsRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER })
    const [summary] = await clients.list()
    const owed = Object.fromEntries(set.statements.map((s) => [s.currency, s.closing_cents]))
    for (const total of summary?.outstanding ?? []) {
      expect(owed[total.currency]).toBe(total.cents)
    }
    expect(summary?.outstanding.length).toBe(2)
  })

  it('ages the closing balance by days past due', async () => {
    const set = await repo.statement(CLIENT, '2026-10-01', '2026-11-25')
    const kes = set.statements.find((s) => s.currency === 'KES')!
    // INV-0010 due 20/10 still owes 400,000 (36 days); INV-0011 due 04/11 owes 600,000 (21 days).
    expect(kes.aging).toMatchObject({ days_1_30_cents: 600_000, days_31_60_cents: 400_000 })
  })

  it('is refused to sales', async () => {
    await expect(
      new StatementRepository(db, 'sales').statement(CLIENT, '2026-10-01', '2026-10-31'),
    ).rejects.toThrow(/cannot produce/)
  })
})
