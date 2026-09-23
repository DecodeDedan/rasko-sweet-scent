import { beforeEach, describe, expect, it } from 'vitest'

import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import type { Role } from '../../../auth/session.js'
import { PayrollRepository, PayrollRuleError } from '../payrollRepository.js'
import { computePayroll } from '../statutory.js'
import type { RatesSnapshot } from '../statutory.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-09-16T09:00:00.000Z'

const EMPLOYEE = {
  grace: 'e0000000-0000-4000-8000-000000000001',
  peter: 'e0000000-0000-4000-8000-000000000002',
} as const

const RATES: RatesSnapshot = {
  paye: {
    personal_relief_cents: 240_000,
    bands: [
      { upto_cents: 2_880_000, rate_bp: 1000 },
      { upto_cents: 3_880_000, rate_bp: 2500 },
      { upto_cents: null, rate_bp: 3000 },
    ],
  },
  nssf: { tier_1_cap_cents: 800_000, tier_2_cap_cents: 7_200_000, rate_bp: 600 },
  shif: { rate_bp: 275, minimum_cents: 30_000 },
  housing_levy: { rate_bp: 150, cap_cents: null },
}

let db: SqlDatabase

async function seed(): Promise<SqlDatabase> {
  const database = openNodeDatabase()
  await migrateLocalSchema(database)

  const rate = async (id: string, kind: string, config: unknown) =>
    database.execute(
      `INSERT INTO statutory_rates (id, kind, effective_from, config, created_at, updated_at, sync_status)
       VALUES (?, ?, '2026-01-01', ?, ?, ?, 'synced')`,
      [id, kind, JSON.stringify(config), NOW, NOW],
    )

  await rate('5a000000-0000-4000-8000-000000000001', 'paye', RATES.paye)
  await rate('5a000000-0000-4000-8000-000000000002', 'nssf', RATES.nssf)
  await rate('5a000000-0000-4000-8000-000000000003', 'shif', RATES.shif)
  await rate('5a000000-0000-4000-8000-000000000004', 'housing_levy', RATES.housing_levy)

  const employee = async (id: string, name: string, nationalId: string, pay: number) =>
    database.execute(
      `INSERT INTO employees (id, full_name, national_id, salary_type, basic_pay_cents,
                              allowances, payment_method, is_active, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, 'monthly', ?, '[]', 'mpesa', 1, ?, ?, 'synced')`,
      [id, name, nationalId, pay, NOW, NOW],
    )

  await employee(EMPLOYEE.grace, 'Grace Wanjiru', '12345678', 5_000_000)
  await employee(EMPLOYEE.peter, 'Peter Otieno', '87654321', 3_000_000)

  return database
}

function repoFor(database: SqlDatabase, role: Role = 'owner'): PayrollRepository {
  return new PayrollRepository(database, role, OWNER, { userId: OWNER }, () => NOW)
}

beforeEach(async () => {
  db = await seed()
})

describe('payroll runs (FR-8.4)', () => {
  it('computes every active employee and totals the run', async () => {
    const repo = repoFor(db)
    const run = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })

    expect(run.items).toHaveLength(2)
    expect(run.status).toBe('prepared')
    expect(run.totals.employeeCount).toBe(2)

    const grace = run.items.find((item) => item.employee_id === EMPLOYEE.grace)
    const expected = computePayroll({ basicPayCents: 5_000_000, allowances: [] }, RATES)

    expect(grace?.gross_cents).toBe(expected.grossCents)
    expect(grace?.paye_cents).toBe(expected.payeCents)
    expect(grace?.net_pay_cents).toBe(expected.netPayCents)

    expect(run.totals.netPayCents).toBe(
      run.items.reduce((sum, item) => sum + item.net_pay_cents, 0),
    )
  })

  it('snapshots the rates so an old payslip stays reproducible (FR-9.3)', async () => {
    const repo = repoFor(db)
    const run = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })

    expect(run.rates_snapshot.paye.personal_relief_cents).toBe(240_000)

    // The law changes afterwards.
    await db.execute(`UPDATE statutory_rates SET config = ? WHERE kind = 'paye'`, [
      JSON.stringify({ ...RATES.paye, personal_relief_cents: 999_999 }),
    ])

    const reread = await repo.runDetail(run.id)
    expect(reread?.rates_snapshot.paye.personal_relief_cents).toBe(240_000)
  })

  it('freezes the employee details onto the payslip (FR-8.6)', async () => {
    const repo = repoFor(db)
    const run = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })

    await repo.updateEmployee(EMPLOYEE.grace, { full_name: 'Grace Married-Name' })

    const reread = await repo.runDetail(run.id)
    const item = reread?.items.find((candidate) => candidate.employee_id === EMPLOYEE.grace)
    expect(item?.employee_snapshot.full_name).toBe('Grace Wanjiru')
  })

  it('refuses to run the same month twice', async () => {
    const repo = repoFor(db)
    await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })

    await expect(
      repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 }),
    ).rejects.toThrow(/already exists for that month/i)
  })

  it('pays a daily-rate employee for days worked', async () => {
    await db.execute(
      `UPDATE employees SET salary_type = 'daily', basic_pay_cents = 120000 WHERE id = ?`,
      [EMPLOYEE.peter],
    )

    const repo = repoFor(db)
    const run = await repo.prepareRun({
      id: crypto.randomUUID(),
      year: 2026,
      month: 9,
      daysWorked: { [EMPLOYEE.peter]: 20 },
    })

    const peter = run.items.find((item) => item.employee_id === EMPLOYEE.peter)
    expect(peter?.basic_pay_cents).toBe(2_400_000)
    expect(peter?.days_worked).toBe(20)
  })

  it('refuses when the statutory rates are unusable', async () => {
    await db.execute(`DELETE FROM statutory_rates WHERE kind = 'paye'`)
    const repo = repoFor(db)

    await expect(
      repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 }),
    ).rejects.toThrow(/not usable/i)
  })
})

describe('partial rows from the server (FR-8.4)', () => {
  it('fills in missing totals rather than handing the UI undefined', async () => {
    // A run can reach a device with totals '{}' — the seed does exactly this,
    // and so does any run inserted before its items were computed. Every figure
    // then arrives undefined, and formatKes(undefined) throws, which takes the
    // whole Payroll screen down with it.
    await db.execute(
      `INSERT INTO payroll_runs (id, period_year, period_month, status, rates_snapshot,
                                 totals, created_at, updated_at, sync_status)
       VALUES (?, 2026, 8, 'draft', '{}', '{}', ?, ?, 'synced')`,
      [crypto.randomUUID(), NOW, NOW],
    )

    const runs = await repoFor(db).listRuns()
    const partial = runs.find((run) => run.period_month === 8)

    expect(partial).toBeDefined()
    for (const value of Object.values(partial!.totals)) {
      expect(Number.isFinite(value)).toBe(true)
    }
    expect(partial!.totals.grossCents).toBe(0)
    expect(partial!.totals.employeeCount).toBe(0)
  })
})

describe('advances (FR-8.3)', () => {
  it('recovers an approved advance once, and never again', async () => {
    const repo = repoFor(db)
    const advanceId = crypto.randomUUID()

    await repo.requestAdvance({
      id: advanceId,
      employeeId: EMPLOYEE.grace,
      amountCents: 500_000,
    })
    await repo.decideAdvance(advanceId, 'approved')

    const first = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })
    const grace = first.items.find((item) => item.employee_id === EMPLOYEE.grace)
    expect(grace?.advance_deduction_cents).toBe(500_000)

    const advances = await repo.listAdvances(EMPLOYEE.grace)
    expect(advances[0]?.status).toBe('recovered')
    expect(advances[0]?.recovered_in_run_id).toBe(first.id)

    // Next month: nothing left to recover.
    const second = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 10 })
    const graceAgain = second.items.find((item) => item.employee_id === EMPLOYEE.grace)
    expect(graceAgain?.advance_deduction_cents).toBe(0)
  })

  it('never deducts an advance that is only pending', async () => {
    const repo = repoFor(db)
    await repo.requestAdvance({
      id: crypto.randomUUID(),
      employeeId: EMPLOYEE.grace,
      amountCents: 500_000,
    })

    const run = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })
    const grace = run.items.find((item) => item.employee_id === EMPLOYEE.grace)
    expect(grace?.advance_deduction_cents).toBe(0)
  })

  it('lets only the owner approve', async () => {
    const owner = repoFor(db)
    const advanceId = crypto.randomUUID()
    await owner.requestAdvance({
      id: advanceId,
      employeeId: EMPLOYEE.grace,
      amountCents: 100_000,
    })

    const manager = repoFor(db, 'manager')
    await expect(manager.decideAdvance(advanceId, 'approved')).rejects.toThrow(PayrollRuleError)
    await expect(owner.decideAdvance(advanceId, 'approved')).resolves.toBeUndefined()
  })

  it('refuses to decide an advance twice', async () => {
    const repo = repoFor(db)
    const advanceId = crypto.randomUUID()
    await repo.requestAdvance({
      id: advanceId,
      employeeId: EMPLOYEE.grace,
      amountCents: 100_000,
    })
    await repo.decideAdvance(advanceId, 'approved')

    await expect(repo.decideAdvance(advanceId, 'rejected')).rejects.toThrow(/already been decided/i)
  })
})

describe('approval and payment (FR-8.5, FR-8.7, FR-8.8)', () => {
  it('lets an accountant prepare but never approve', async () => {
    const accountant = repoFor(db, 'accountant')
    const run = await accountant.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })

    await expect(accountant.transitionRun(run.id, 'approved')).rejects.toThrow(
      /only the owner can approve/i,
    )
    await expect(repoFor(db).transitionRun(run.id, 'approved')).resolves.toBeUndefined()
  })

  it('keeps a manager read-only', async () => {
    const manager = repoFor(db, 'manager')
    await expect(
      manager.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 }),
    ).rejects.toThrow(PayrollRuleError)
    await expect(
      manager.createEmployee({ id: crypto.randomUUID(), full_name: 'X', national_id: '1' }),
    ).rejects.toThrow(PayrollRuleError)
  })

  it('records who approved and when', async () => {
    const repo = repoFor(db)
    const run = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })
    await repo.transitionRun(run.id, 'approved')

    const approved = await repo.findRun(run.id)
    expect(approved?.approved_by).toBe(OWNER)
    expect(approved?.approved_at).toBe(NOW)
  })

  it('refuses payment before approval, and closes the run when everyone is paid', async () => {
    const repo = repoFor(db)
    const run = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })

    await expect(repo.markPaid({ runId: run.id, method: 'mpesa' })).rejects.toThrow(
      /approve the run/i,
    )

    await repo.transitionRun(run.id, 'approved')
    await repo.markPaid({ runId: run.id, method: 'mpesa', reference: 'BATCH-1' })

    const after = await repo.runDetail(run.id)
    expect(after?.status).toBe('paid')
    expect(after?.items.every((item) => item.paid_at === NOW)).toBe(true)
  })

  it('runs the pipeline forward only', async () => {
    const repo = repoFor(db)
    const run = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })
    await repo.transitionRun(run.id, 'approved')

    await expect(repo.transitionRun(run.id, 'prepared')).rejects.toThrow(/cannot move from/i)
  })
})

describe('employees (FR-8.1)', () => {
  it('rejects a duplicate national ID', async () => {
    const repo = repoFor(db)
    await expect(
      repo.createEmployee({
        id: crypto.randomUUID(),
        full_name: 'Someone Else',
        national_id: '12345678',
      }),
    ).rejects.toThrow(/already exists/i)
  })

  it('excludes inactive staff from a run', async () => {
    await db.execute('UPDATE employees SET is_active = 0 WHERE id = ?', [EMPLOYEE.peter])
    const repo = repoFor(db)
    const run = await repo.prepareRun({ id: crypto.randomUUID(), year: 2026, month: 9 })

    expect(run.items).toHaveLength(1)
    expect(run.items[0]?.employee_id).toBe(EMPLOYEE.grace)
  })
})
