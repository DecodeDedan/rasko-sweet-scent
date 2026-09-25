import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
import { computePayroll, validateRatesSnapshot } from './statutory.js'
import type { Allowance, RatesSnapshot } from './statutory.js'
import {
  EMPTY_TOTALS,
  canApproveAdvance,
  canApprovePayroll,
  canEditEmployees,
  canPreparePayroll,
  canRequestAdvance,
  canTransitionRun,
} from './types.js'
import type {
  Advance,
  Employee,
  EmployeeSnapshot,
  PayrollItem,
  PayrollRun,
  PayrollRunDetail,
  PayrollRunStatus,
  PayrollTotals,
} from './types.js'

/**
 * Employees and payroll (FR-8.1 – FR-8.9).
 *
 * ## A run snapshots the rates it used
 *
 * `payroll_runs.rates_snapshot` is copied in at preparation and frozen on
 * approval by `app.guard_payroll_approval`. Reprinting an eight-month-old
 * payslip therefore reproduces the original figures rather than recomputing
 * against whatever the law says today (FR-9.3, architecture.md §11 #4).
 *
 * ## An advance is recovered exactly once
 *
 * `advances.recovered_in_run_id` is what stops a double deduction (FR-8.3). It
 * is set in the same pass that writes the payroll item, and an advance already
 * carrying a run id is never picked up again.
 */

export class PayrollRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayrollRuleError'
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === 'object') return value as T
  try {
    return JSON.parse(String(value)) as T
  } catch {
    return fallback
  }
}

/**
 * Parses a jsonb object column and fills in whatever the row is missing.
 *
 * The partial object is the dangerous case, not the null one.
 * `payroll_runs.totals` arrives as `{}` from the seed, and from any run stored
 * before its items were computed. That is valid JSON, so a plain fallback never
 * fires and every figure reaches the UI as `undefined` — at which point
 * `formatKes(undefined)` throws, React unmounts the tree, and the whole Payroll
 * module renders a blank page.
 *
 * Merging over the default keeps a partial row readable instead of fatal.
 */
function parseJsonObject<T extends object>(value: unknown, fallback: T): T {
  const parsed = parseJson<Partial<T> | null>(value, null)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...fallback }
  return { ...fallback, ...parsed }
}

/** Every field a payslip reads, so a partial snapshot still renders. */
const EMPTY_SNAPSHOT: EmployeeSnapshot = {
  full_name: 'Unknown employee',
  national_id: '',
  kra_pin: null,
  nssf_number: null,
  shif_number: null,
  position: null,
  salary_type: 'monthly',
  payment_method: null,
}

export class PayrollRepository {
  private readonly employees: Repository<Record<string, unknown>>
  private readonly advances: Repository<Record<string, unknown>>
  private readonly runs: Repository<Record<string, unknown>>
  private readonly items: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly role: Role,
    private readonly userId: string | null,
    context: WriteContext,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.employees = new Repository(db, 'employees', context)
    this.advances = new Repository(db, 'advances', context)
    this.runs = new Repository(db, 'payroll_runs', context)
    this.items = new Repository(db, 'payroll_items', context)
  }

  // ------------------------------------------------------------- FR-8.1/8.2

  async listEmployees(options: { includeInactive?: boolean } = {}): Promise<Employee[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM employees
       WHERE deleted_at IS NULL ${options.includeInactive ? '' : 'AND is_active = 1'}
       ORDER BY full_name COLLATE NOCASE`,
    )
    return rows.map((row) => this.toEmployee(row))
  }

  async findEmployee(id: string): Promise<Employee | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      'SELECT * FROM employees WHERE id = ?',
      [id],
    )
    const row = rows[0]
    return row ? this.toEmployee(row) : null
  }

  async createEmployee(
    input: Partial<Employee> & { id: string; full_name: string; national_id: string },
  ): Promise<Employee> {
    if (!canEditEmployees(this.role)) {
      throw new PayrollRuleError('Only the owner can add or change employee records (FR-8.8).')
    }
    if (!input.full_name.trim()) throw new PayrollRuleError('An employee needs a name.')
    if (!input.national_id.trim()) throw new PayrollRuleError('An employee needs a national ID.')

    const duplicate = await this.db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM employees WHERE national_id = ? AND deleted_at IS NULL',
      [input.national_id.trim()],
    )
    if (Number(duplicate[0]?.n ?? 0) > 0) {
      throw new PayrollRuleError('An employee with that national ID already exists.')
    }

    await this.employees.insert({
      ...input,
      full_name: input.full_name.trim(),
      national_id: input.national_id.trim(),
      salary_type: input.salary_type ?? 'monthly',
      basic_pay_cents: input.basic_pay_cents ?? 0,
      allowances: input.allowances ?? [],
      is_active: input.is_active ?? true,
    })

    const created = await this.findEmployee(input.id)
    if (!created) throw new PayrollRuleError('The employee could not be read back after saving.')
    return created
  }

  async updateEmployee(id: string, patch: Partial<Employee>): Promise<void> {
    if (!canEditEmployees(this.role)) {
      throw new PayrollRuleError('Only the owner can add or change employee records (FR-8.8).')
    }
    await this.employees.update(id, patch)
  }

  // --------------------------------------------------------------- FR-8.3

  async listAdvances(employeeId?: string): Promise<Advance[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT a.*, COALESCE(e.full_name, 'Unknown employee') AS employee_name
       FROM advances a
       LEFT JOIN employees e ON e.id = a.employee_id
       WHERE a.deleted_at IS NULL ${employeeId ? 'AND a.employee_id = ?' : ''}
       ORDER BY a.requested_at DESC`,
      employeeId ? [employeeId] : [],
    )
    return rows.map((row) => this.toAdvance(row))
  }

  async requestAdvance(input: {
    id: string
    employeeId: string
    amountCents: number
  }): Promise<void> {
    if (!canRequestAdvance(this.role)) {
      throw new PayrollRuleError('Only an owner or manager can request a salary advance (FR-8.3).')
    }
    if (input.amountCents <= 0) {
      throw new PayrollRuleError('An advance must be greater than zero.')
    }

    await this.advances.insert({
      id: input.id,
      employee_id: input.employeeId,
      amount_cents: input.amountCents,
      requested_at: this.clock(),
      requested_by: this.userId,
      status: 'pending',
    })
  }

  /** FR-8.3, mirrored by `app.guard_advance_approval`. */
  async decideAdvance(id: string, decision: 'approved' | 'rejected'): Promise<void> {
    if (!canApproveAdvance(this.role)) {
      throw new PayrollRuleError('Only the owner can approve a salary advance (FR-8.3).')
    }

    const rows = await this.db.select<Record<string, unknown>>(
      'SELECT status FROM advances WHERE id = ?',
      [id],
    )
    const current = rows[0]
    if (!current) throw new PayrollRuleError('Advance not found on this device.')
    if (String(current['status']) !== 'pending') {
      throw new PayrollRuleError('That advance has already been decided.')
    }

    // The CHECK constraint requires approver and timestamp together, or neither.
    await this.advances.update(id, {
      status: decision,
      ...(decision === 'approved'
        ? { approved_at: this.clock(), approved_by: this.userId }
        : { approved_at: null, approved_by: null }),
    })
  }

  // --------------------------------------------------------------- FR-8.4

  /** The rates in force, keyed by scheme — copied into the run at preparation. */
  async currentRates(onDate: string = this.clock().slice(0, 10)): Promise<RatesSnapshot> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT kind, config FROM statutory_rates
       WHERE deleted_at IS NULL
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC`,
      [onDate, onDate],
    )

    const snapshot: Record<string, unknown> = {}
    for (const row of rows) {
      const kind = String(row['kind'])
      // Rows are newest-first, so the first of each kind wins.
      if (!(kind in snapshot)) snapshot[kind] = parseJson(row['config'], {})
    }

    const problems = validateRatesSnapshot(snapshot as Partial<RatesSnapshot>)
    if (problems.length > 0) {
      throw new PayrollRuleError(
        `Statutory rates are not usable: ${problems.join(' ')} Set them in Settings before running payroll.`,
      )
    }
    return snapshot as unknown as RatesSnapshot
  }

  async listRuns(): Promise<PayrollRun[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM payroll_runs WHERE deleted_at IS NULL
       ORDER BY period_year DESC, period_month DESC`,
    )
    return rows.map((row) => this.toRun(row))
  }

  async findRun(id: string): Promise<PayrollRun | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      'SELECT * FROM payroll_runs WHERE id = ?',
      [id],
    )
    const row = rows[0]
    return row ? this.toRun(row) : null
  }

  async runDetail(id: string): Promise<PayrollRunDetail | null> {
    const run = await this.findRun(id)
    if (!run) return null

    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM payroll_items WHERE payroll_run_id = ? AND deleted_at IS NULL
       ORDER BY json_extract(employee_snapshot, '$.full_name') COLLATE NOCASE`,
      [id],
    )
    return { ...run, items: rows.map((row) => this.toItem(row)) }
  }

  /**
   * FR-8.4. Computes the month for every active employee, recovers approved
   * advances, and writes the run with the rates it used.
   *
   * Re-running a month is not allowed: `payroll_runs_period_key` is unique on
   * (year, month), which is the guard against paying a month twice.
   */
  async prepareRun(input: {
    id: string
    year: number
    month: number
    daysWorked?: Record<string, number>
  }): Promise<PayrollRunDetail> {
    if (!canPreparePayroll(this.role)) {
      throw new PayrollRuleError('Only an owner or accountant can prepare payroll (FR-8.5).')
    }
    if (input.month < 1 || input.month > 12) {
      throw new PayrollRuleError('The payroll month must be between 1 and 12.')
    }

    const existing = await this.db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM payroll_runs
       WHERE period_year = ? AND period_month = ? AND deleted_at IS NULL`,
      [input.year, input.month],
    )
    if (Number(existing[0]?.n ?? 0) > 0) {
      throw new PayrollRuleError('A payroll run already exists for that month.')
    }

    const employees = await this.listEmployees()
    if (employees.length === 0) {
      throw new PayrollRuleError('There are no active employees to pay.')
    }

    const rates = await this.currentRates()
    const now = this.clock()

    await this.runs.insert({
      id: input.id,
      period_year: input.year,
      period_month: input.month,
      status: 'draft',
      prepared_at: now,
      prepared_by: this.userId,
      rates_snapshot: rates,
      totals: EMPTY_TOTALS,
    })

    const totals: PayrollTotals = { ...EMPTY_TOTALS }

    for (const employee of employees) {
      const pending = await this.approvedAdvancesFor(employee.id)
      const advanceCents = pending.reduce((sum, advance) => sum + advance.amount_cents, 0)

      const result = computePayroll(
        {
          basicPayCents: employee.basic_pay_cents,
          allowances: employee.allowances,
          salaryType: employee.salary_type,
          daysWorked: input.daysWorked?.[employee.id] ?? 0,
          advanceDeductionCents: advanceCents,
        },
        rates,
      )

      const itemId = crypto.randomUUID()
      await this.items.insert({
        id: itemId,
        payroll_run_id: input.id,
        employee_id: employee.id,
        employee_snapshot: this.snapshotOf(employee),
        days_worked:
          employee.salary_type === 'daily' ? (input.daysWorked?.[employee.id] ?? 0) : null,
        basic_pay_cents: result.basicPayCents,
        allowances: employee.allowances,
        gross_cents: result.grossCents,
        paye_cents: result.payeCents,
        nssf_cents: result.nssfCents,
        shif_cents: result.shifCents,
        housing_levy_cents: result.housingLevyCents,
        advance_deduction_cents: result.advanceDeductionCents,
        other_deductions: [],
        net_pay_cents: result.netPayCents,
        payment_method: employee.payment_method,
      })

      // Marking recovery in the same pass is what makes an advance one-shot.
      for (const advance of pending) {
        await this.advances.update(advance.id, {
          status: 'recovered',
          recovered_in_run_id: input.id,
        })
      }

      totals.employeeCount += 1
      totals.grossCents += result.grossCents
      totals.payeCents += result.payeCents
      totals.nssfCents += result.nssfCents
      totals.shifCents += result.shifCents
      totals.housingLevyCents += result.housingLevyCents
      totals.advanceCents += result.advanceDeductionCents
      totals.netPayCents += result.netPayCents
    }

    await this.runs.update(input.id, { status: 'prepared', totals })

    const detail = await this.runDetail(input.id)
    if (!detail) throw new PayrollRuleError('The payroll run could not be read back after saving.')
    return detail
  }

  private async approvedAdvancesFor(employeeId: string): Promise<Advance[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT a.*, '' AS employee_name FROM advances a
       WHERE a.employee_id = ? AND a.status = 'approved'
         AND a.recovered_in_run_id IS NULL AND a.deleted_at IS NULL`,
      [employeeId],
    )
    return rows.map((row) => this.toAdvance(row))
  }

  /** FR-8.5. Approval is owner-only here and again in the server trigger. */
  async transitionRun(id: string, to: PayrollRunStatus): Promise<void> {
    const run = await this.findRun(id)
    if (!run) throw new PayrollRuleError('Payroll run not found on this device.')

    if (!canTransitionRun(run.status, to)) {
      throw new PayrollRuleError(`A payroll run cannot move from ${run.status} to ${to}.`)
    }
    if ((to === 'approved' || to === 'paid') && !canApprovePayroll(this.role)) {
      throw new PayrollRuleError('Only the owner can approve a payroll run (FR-8.5).')
    }
    if (to !== 'approved' && to !== 'paid' && !canPreparePayroll(this.role)) {
      throw new PayrollRuleError('Only an owner or accountant can change a payroll run.')
    }

    await this.runs.update(id, {
      status: to,
      ...(to === 'approved' ? { approved_at: this.clock(), approved_by: this.userId } : {}),
    })
  }

  /** FR-8.7. Records the money leaving, per employee or for the whole run. */
  async markPaid(input: {
    runId: string
    itemId?: string
    method: 'mpesa' | 'bank'
    reference?: string | null
  }): Promise<void> {
    if (!canApprovePayroll(this.role)) {
      throw new PayrollRuleError('Only the owner can record salary payments (FR-8.7).')
    }

    const run = await this.findRun(input.runId)
    if (!run) throw new PayrollRuleError('Payroll run not found on this device.')
    if (run.status !== 'approved' && run.status !== 'paid') {
      throw new PayrollRuleError('Approve the run before recording payment.')
    }

    // A payslip M-Pesa is paying, or has paid, is settled by M-Pesa alone
    // (migration 20260928000300 refuses it too): marking it by hand would pay
    // the salary twice, or wipe the M-Pesa receipt.
    const byMpesa = await this.payslipsPaidByMpesa(input.runId)
    const detail = await this.runDetail(input.runId)
    const items = detail?.items ?? []
    if (input.itemId && byMpesa.has(input.itemId)) {
      throw new PayrollRuleError(
        'This payslip is paid by M-Pesa. It is marked paid when M-Pesa confirms.',
      )
    }
    const targets = input.itemId
      ? items.filter((item) => item.id === input.itemId && item.paid_at === null)
      : items.filter((item) => item.paid_at === null && !byMpesa.has(item.id))

    if (targets.length === 0) {
      throw new PayrollRuleError(
        byMpesa.size > 0
          ? 'Everything left in this run is being paid by M-Pesa.'
          : 'There is nothing left to pay.',
      )
    }

    const now = this.clock()
    for (const item of targets) {
      await this.items.update(item.id, {
        paid_at: now,
        payment_method: input.method,
        payment_reference: input.reference ?? null,
      })
    }

    const after = await this.runDetail(input.runId)
    if (after && after.items.every((item) => item.paid_at !== null) && run.status !== 'paid') {
      await this.runs.update(input.runId, { status: 'paid' })
    }
  }

  /** Payslips in the run with an M-Pesa payout in flight or paid. */
  private async payslipsPaidByMpesa(runId: string): Promise<Set<string>> {
    const rows = await this.db.select<{ payroll_item_id: string }>(
      `SELECT DISTINCT payroll_item_id FROM payroll_payouts
        WHERE payroll_run_id = ? AND deleted_at IS NULL
          AND status IN ('queued', 'sending', 'accepted', 'unknown', 'paid')`,
      [runId],
    )
    return new Set(rows.map((row) => row.payroll_item_id))
  }

  // ------------------------------------------------------------- mapping

  private snapshotOf(employee: Employee): EmployeeSnapshot {
    return {
      full_name: employee.full_name,
      national_id: employee.national_id,
      kra_pin: employee.kra_pin,
      nssf_number: employee.nssf_number,
      shif_number: employee.shif_number,
      position: employee.position,
      salary_type: employee.salary_type,
      payment_method: employee.payment_method,
    }
  }

  private toEmployee(row: Record<string, unknown>): Employee {
    return {
      id: String(row['id']),
      profile_id: (row['profile_id'] as string | null) ?? null,
      full_name: String(row['full_name']),
      national_id: String(row['national_id']),
      kra_pin: (row['kra_pin'] as string | null) ?? null,
      nssf_number: (row['nssf_number'] as string | null) ?? null,
      shif_number: (row['shif_number'] as string | null) ?? null,
      phone: (row['phone'] as string | null) ?? null,
      position: (row['position'] as string | null) ?? null,
      salary_type: String(row['salary_type'] ?? 'monthly') as Employee['salary_type'],
      basic_pay_cents: Number(row['basic_pay_cents'] ?? 0),
      allowances: parseJson<Allowance[]>(row['allowances'], []),
      payment_method: (row['payment_method'] as Employee['payment_method']) ?? null,
      payment_details: parseJson<Record<string, unknown> | null>(row['payment_details'], null),
      is_active: Number(row['is_active'] ?? 1) !== 0,
      created_at: (row['created_at'] as string | null) ?? null,
      updated_at: (row['updated_at'] as string | null) ?? null,
      deleted_at: (row['deleted_at'] as string | null) ?? null,
    }
  }

  private toAdvance(row: Record<string, unknown>): Advance {
    return {
      id: String(row['id']),
      employee_id: String(row['employee_id']),
      employeeName: String(row['employee_name'] ?? ''),
      amount_cents: Number(row['amount_cents'] ?? 0),
      requested_at: String(row['requested_at']),
      requested_by: (row['requested_by'] as string | null) ?? null,
      status: String(row['status'] ?? 'pending') as Advance['status'],
      approved_at: (row['approved_at'] as string | null) ?? null,
      approved_by: (row['approved_by'] as string | null) ?? null,
      recovered_in_run_id: (row['recovered_in_run_id'] as string | null) ?? null,
    }
  }

  private toRun(row: Record<string, unknown>): PayrollRun {
    return {
      id: String(row['id']),
      period_year: Number(row['period_year']),
      period_month: Number(row['period_month']),
      status: String(row['status'] ?? 'draft') as PayrollRunStatus,
      prepared_at: (row['prepared_at'] as string | null) ?? null,
      prepared_by: (row['prepared_by'] as string | null) ?? null,
      approved_at: (row['approved_at'] as string | null) ?? null,
      approved_by: (row['approved_by'] as string | null) ?? null,
      rates_snapshot: parseJson<RatesSnapshot>(row['rates_snapshot'], {} as RatesSnapshot),
      totals: parseJsonObject<PayrollTotals>(row['totals'], EMPTY_TOTALS),
      created_at: (row['created_at'] as string | null) ?? null,
      updated_at: (row['updated_at'] as string | null) ?? null,
    }
  }

  private toItem(row: Record<string, unknown>): PayrollItem {
    return {
      id: String(row['id']),
      payroll_run_id: String(row['payroll_run_id']),
      employee_id: String(row['employee_id']),
      employee_snapshot: parseJsonObject<EmployeeSnapshot>(
        row['employee_snapshot'],
        EMPTY_SNAPSHOT,
      ),
      // days_worked is a `qty` column: stored as thousandths, and this raw
      // SELECT bypasses the codec that would otherwise scale it back.
      days_worked: row['days_worked'] == null ? null : Number(row['days_worked']) / 1000,
      basic_pay_cents: Number(row['basic_pay_cents'] ?? 0),
      allowances: parseJson<Allowance[]>(row['allowances'], []),
      gross_cents: Number(row['gross_cents'] ?? 0),
      paye_cents: Number(row['paye_cents'] ?? 0),
      nssf_cents: Number(row['nssf_cents'] ?? 0),
      shif_cents: Number(row['shif_cents'] ?? 0),
      housing_levy_cents: Number(row['housing_levy_cents'] ?? 0),
      advance_deduction_cents: Number(row['advance_deduction_cents'] ?? 0),
      other_deductions: parseJson(row['other_deductions'], []),
      net_pay_cents: Number(row['net_pay_cents'] ?? 0),
      paid_at: (row['paid_at'] as string | null) ?? null,
      payment_method: (row['payment_method'] as PayrollItem['payment_method']) ?? null,
      payment_reference: (row['payment_reference'] as string | null) ?? null,
    }
  }
}
