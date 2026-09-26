import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { pendingCount } from '../../../data/sync/outbox.js'
import { MpesaPayoutsRepository, PayoutRuleError } from '../mpesaPayouts.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const RUN = 'f0000000-0000-4000-8000-000000000001'
const TS = '2026-09-27T08:00:00.000Z'
let seq = 0
const newId = () => `aa000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`
const employee = (n: string) => `e000000${n}-0000-4000-8000-000000000000`
const item = (n: string) => `i000000${n}-0000-4000-8000-000000000000`

async function seed(db: SqlDatabase, status = 'approved') {
  await db.execute(
    `INSERT INTO payroll_runs (id, period_year, period_month, status, created_at, updated_at, sync_status)
     VALUES (?, 2026, 9, ?, ?, ?, 'synced')`,
    [RUN, status, TS, TS],
  )
  // id suffix, name, phone, payment method, net pay cents, paid_at
  const people: Array<[string, string, string | null, string, number, string | null]> = [
    ['1', 'Jane Wanjiku', '+254712345678', 'mpesa', 2345640, null],
    ['2', 'Peter Otieno', '+254722000111', 'mpesa', 1800000, null],
    ['3', 'Mary Chebet', '+254733000222', 'bank', 3000000, null],
    ['4', 'John Kamau', null, 'mpesa', 1500000, null],
    ['5', 'Ann Njeri', '+254744000333', 'mpesa', 1200000, TS],
  ]
  for (const [n, name, phone, method, net, paidAt] of people) {
    await db.execute(
      `INSERT INTO employees (id, full_name, national_id, phone, salary_type, payment_method,
                              is_active, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, 'monthly', ?, 1, ?, ?, 'synced')`,
      [employee(n), name, `ID${n}`, phone, method, TS, TS],
    )
    await db.execute(
      `INSERT INTO payroll_items (id, payroll_run_id, employee_id, net_pay_cents, paid_at,
                                  created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')`,
      [item(n), RUN, employee(n), net, paidAt, TS, TS],
    )
  }
}

describe('M-Pesa salary payouts (migration 20260927000100)', () => {
  let db: SqlDatabase
  let owner: MpesaPayoutsRepository

  beforeEach(async () => {
    db = openNodeDatabase()
    await migrateLocalSchema(db)
    owner = new MpesaPayoutsRepository(db, 'owner', { userId: OWNER })
  })

  afterEach(async () => {
    await db.close()
  })

  it('pays whole shillings to M-Pesa employees and says why the others are left out', async () => {
    await seed(db)
    const plan = await owner.plan(RUN)

    expect(plan.payable.map((line) => line.employeeName)).toEqual(['Jane Wanjiku', 'Peter Otieno'])
    expect(plan.totalShillings).toBe(23456 + 18000)
    const jane = plan.lines.find((line) => line.employeeName === 'Jane Wanjiku')
    expect(jane).toMatchObject({
      amountShillings: 23456,
      remainderCents: 40,
      msisdn: '254712345678',
    })

    const reason = (name: string) => plan.lines.find((line) => line.employeeName === name)?.blocker
    expect(reason('Mary Chebet')).toMatch(/bank account/)
    expect(reason('John Kamau')).toMatch(/M-Pesa number/)
    expect(reason('Ann Njeri')).toMatch(/Already paid/)
  })

  it('queues one payout per payable line once the typed total matches', async () => {
    await seed(db)
    const queued = await owner.request(RUN, '41,456', newId)

    expect(queued).toBe(2)
    expect(await pendingCount(db)).toBe(2)
    const plan = await owner.plan(RUN)
    expect(plan.payable).toHaveLength(0)
    expect(plan.lines.find((line) => line.employeeName === 'Jane Wanjiku')?.blocker).toMatch(
      /already requested/,
    )
  })

  it('refuses a total that does not match what is shown', async () => {
    await seed(db)
    await expect(owner.request(RUN, '41457', newId)).rejects.toThrow(/exactly as shown/)
    expect(await pendingCount(db)).toBe(0)
  })

  it('refuses anyone but the owner, and any run not yet approved', async () => {
    await seed(db, 'prepared')
    const manager = new MpesaPayoutsRepository(db, 'manager', { userId: OWNER })
    await expect(manager.request(RUN, '41456', newId)).rejects.toBeInstanceOf(PayoutRuleError)
    await expect(owner.request(RUN, '41456', newId)).rejects.toThrow(/Approve the payroll run/)
  })

  it('pays a bank employee with a complete account by bank transfer (migration 20260929000100)', async () => {
    await seed(db)
    await db.execute(`UPDATE employees SET payment_details = ? WHERE id = ?`, [
      JSON.stringify({ bank_code: '68', account_number: '0123456789', account_name: 'Mary C' }),
      employee('3'),
    ])

    const plan = await owner.plan(RUN)
    const mary = plan.lines.find((line) => line.employeeName === 'Mary Chebet')
    expect(mary).toMatchObject({
      channel: 'bank',
      destination: 'Equity Bank ···6789',
      blocker: null,
      amountShillings: 30000,
    })
    expect(plan.totalShillings).toBe(23456 + 18000 + 30000)

    await owner.request(RUN, '71456', newId)
    const [queued] = await db.select<{ channel: string; msisdn: string | null }>(
      'SELECT channel, msisdn FROM payroll_payouts WHERE payroll_item_id = ?',
      [item('3')],
    )
    expect(queued).toEqual({ channel: 'bank', msisdn: null })
  })

  it('lets a failed payout be sent again, but never one that may have gone through', async () => {
    await seed(db)
    const insert = (status: string, itemId: string) =>
      db.execute(
        `INSERT INTO payroll_payouts (id, payroll_run_id, payroll_item_id, status,
                                      created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, 'synced')`,
        [newId(), RUN, itemId, status, TS, TS],
      )
    await insert('failed', item('1'))
    await insert('unknown', item('2'))

    const plan = await owner.plan(RUN)
    expect(plan.payable.map((line) => line.employeeName)).toEqual(['Jane Wanjiku'])
  })
})
