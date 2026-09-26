'use client'

import { CalendarClock, DatabaseZap, Plus, Users, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusChip,
  TabPanel,
  Table,
  Tabs,
  formatDate,
  formatKes,
  useToast,
} from '@rasko/ui'

import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { useCompanySettings } from '../invoices/useInvoices.js'
import { EmployeeForm } from './EmployeeForm.js'
import type { EmployeeFormValues } from './EmployeeForm.js'
import { PayslipDocument, periodLabel } from './PayslipDocument.js'
import {
  ADVANCE_STATUS_LABEL,
  RUN_STATUS_LABEL,
  canApproveAdvance,
  canApprovePayroll,
  canEditEmployees,
  canPreparePayroll,
  canRequestAdvance,
  nextRunStatuses,
} from './types.js'
import type {
  Advance,
  Employee,
  PayrollItem,
  PayrollRun,
  PayrollRunDetail,
  PayrollRunStatus,
} from './types.js'
import { PayMpesaDialog } from './PayMpesaDialog.js'
import { usePayrollData, usePayrollRepository } from './usePayroll.js'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  )
}

type View = 'runs' | 'employees' | 'advances'

const TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'runs', label: 'Payroll runs' },
  { id: 'employees', label: 'Employees' },
  { id: 'advances', label: 'Advances' },
]

function runChip(run: PayrollRun) {
  const tone =
    run.status === 'paid'
      ? 'success'
      : run.status === 'approved'
        ? 'success'
        : run.status === 'cancelled'
          ? 'danger'
          : 'neutral'
  return <StatusChip tone={tone}>{RUN_STATUS_LABEL[run.status]}</StatusChip>
}

function advanceChip(advance: Advance) {
  const tone =
    advance.status === 'approved'
      ? 'success'
      : advance.status === 'rejected'
        ? 'danger'
        : advance.status === 'recovered'
          ? 'neutral'
          : 'warning'
  return <StatusChip tone={tone}>{ADVANCE_STATUS_LABEL[advance.status]}</StatusChip>
}

export function PayrollScreen({ role, scope }: ScreenProps) {
  const repo = usePayrollRepository()
  const company = useCompanySettings()
  const { showToast } = useToast()
  const { runs, employees, advances, error, reload } = usePayrollData()

  const [view, setView] = useState<View>('runs')
  const [openRun, setOpenRun] = useState<PayrollRunDetail | null>(null)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [isAddingEmployee, setIsAddingEmployee] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)
  const [isRequestingAdvance, setIsRequestingAdvance] = useState(false)
  const [payslip, setPayslip] = useState<{ item: PayrollItem; run: PayrollRun } | null>(null)

  const canPrepare = canPreparePayroll(role)
  const canApprove = canApprovePayroll(role)
  const [payingRun, setPayingRun] = useState<PayrollRun | null>(null)
  // Bumped when an employee is saved, so an open pay dialog re-reads its plan.
  const [employeesVersion, setEmployeesVersion] = useState(0)

  const [refreshError, setRefreshError] = useState<string | null>(null)

  const openRunId = openRun?.id ?? null
  const refreshOpenRun = useCallback(async () => {
    if (!repo || !openRunId) return
    try {
      setRefreshError(null)
      setOpenRun(await repo.runDetail(openRunId))
    } catch (cause) {
      // Left unhandled, an approval appears to succeed while the open run keeps
      // showing its pre-approval figures.
      setRefreshError(cause instanceof Error ? cause.message : 'Could not re-read the run.')
    }
  }, [repo, openRunId])

  useEffect(() => {
    void refreshOpenRun()
  }, [refreshOpenRun])

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Payroll" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="Payroll is held on the device. Run the installed application to see it."
          />
        </Card>
      </div>
    )
  }

  async function saveEmployee(values: EmployeeFormValues) {
    try {
      if (editing) await repo!.updateEmployee(editing.id, values)
      else await repo!.createEmployee({ id: newId(), ...values })
      showToast({ tone: 'success', title: editing ? 'Employee updated' : 'Employee added' })
      await reload()
      setEmployeesVersion((version) => version + 1)
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not save the employee.' }
    }
  }

  async function moveRun(run: PayrollRun, to: PayrollRunStatus) {
    try {
      await repo!.transitionRun(run.id, to)
      showToast({ tone: 'success', title: `Run ${RUN_STATUS_LABEL[to].toLowerCase()}` })
      await reload()
      await refreshOpenRun()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not update the run',
        ...(cause instanceof Error ? { description: cause.message } : {}),
      })
    }
  }

  async function decide(advance: Advance, decision: 'approved' | 'rejected') {
    try {
      await repo!.decideAdvance(advance.id, decision)
      showToast({ tone: 'success', title: `Advance ${decision}` })
      await reload()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not update the advance',
        ...(cause instanceof Error ? { description: cause.message } : {}),
      })
    }
  }

  async function payRun(run: PayrollRun) {
    try {
      await repo!.markPaid({ runId: run.id, method: 'mpesa' })
      showToast({ tone: 'success', title: 'Salaries marked paid' })
      await reload()
      await refreshOpenRun()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not record payment',
        ...(cause instanceof Error ? { description: cause.message } : {}),
      })
    }
  }

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Payroll"
        description="Monthly runs, statutory deductions at the rates in force, and payslips."
        meta={<ScopeBadge scope={scope} />}
        actions={
          <>
            {canPrepare ? (
              <Button
                variant="primary"
                leadingIcon={<CalendarClock size={15} aria-hidden="true" />}
                onClick={() => setIsPreparing(true)}
                disabled={employees.filter((employee) => employee.is_active).length === 0}
              >
                Prepare run
              </Button>
            ) : null}
            {canEditEmployees(role) ? (
              <Button
                variant="secondary"
                leadingIcon={<Plus size={15} aria-hidden="true" />}
                onClick={() => setIsAddingEmployee(true)}
              >
                Add employee
              </Button>
            ) : null}
          </>
        }
      />

      {error || refreshError ? (
        <p className="auth-error" role="alert">
          {error ?? refreshError}
        </p>
      ) : null}

      <Tabs
        items={TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
        activeId={view}
        onChange={(id) => setView(id as View)}
      />

      <TabPanel id="runs" activeId={view}>
        <Card isFlush>
          <Table
            rows={runs}
            getRowKey={(run) => run.id}
            empty={
              <EmptyState
                icon={<Wallet size={20} aria-hidden="true" />}
                title="No payroll runs yet"
                description="Prepare a run to compute gross pay, statutory deductions and net pay for every active employee."
                action={
                  canPrepare ? (
                    <Button variant="primary" onClick={() => setIsPreparing(true)}>
                      Prepare run
                    </Button>
                  ) : undefined
                }
              />
            }
            columns={[
              { key: 'period', header: 'Period', render: (run) => periodLabel(run) },
              { key: 'status', header: 'Status', render: runChip },
              {
                key: 'employees',
                header: 'Employees',
                isNumeric: true,
                render: (run) => String(run.totals.employeeCount),
              },
              {
                key: 'gross',
                header: 'Gross',
                isNumeric: true,
                render: (run) => formatKes(run.totals.grossCents),
              },
              {
                key: 'net',
                header: 'Net pay',
                isNumeric: true,
                render: (run) => formatKes(run.totals.netPayCents),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (run) => {
                  const next = nextRunStatuses(run.status).filter(
                    (status) => status !== 'cancelled',
                  )[0]
                  return (
                    <>
                      <Button
                        variant="ghost"
                        onClick={async () => setOpenRun(await repo!.runDetail(run.id))}
                      >
                        Open
                      </Button>
                      {next === 'approved' && canApprove ? (
                        <Button variant="ghost" onClick={() => void moveRun(run, 'approved')}>
                          Approve
                        </Button>
                      ) : null}
                      {(run.status === 'approved' || run.status === 'paid') && canApprove ? (
                        <Button variant="ghost" onClick={() => setPayingRun(run)}>
                          Pay salaries
                        </Button>
                      ) : null}
                      {run.status === 'approved' && canApprove ? (
                        <Button variant="ghost" onClick={() => void payRun(run)}>
                          Mark paid
                        </Button>
                      ) : null}
                    </>
                  )
                },
              },
            ]}
          />
        </Card>
      </TabPanel>

      <TabPanel id="employees" activeId={view}>
        <Card isFlush>
          <Table
            rows={employees}
            getRowKey={(employee) => employee.id}
            empty={
              <EmptyState
                icon={<Users size={20} aria-hidden="true" />}
                title="No employees yet"
                description="Add your staff with their salary and statutory numbers so payroll can be computed."
                action={
                  canEditEmployees(role) ? (
                    <Button variant="primary" onClick={() => setIsAddingEmployee(true)}>
                      Add employee
                    </Button>
                  ) : undefined
                }
              />
            }
            columns={[
              { key: 'name', header: 'Employee', render: (employee) => employee.full_name },
              {
                key: 'position',
                header: 'Position',
                render: (employee) => employee.position ?? '—',
              },
              {
                key: 'type',
                header: 'Paid',
                render: (employee) => (employee.salary_type === 'daily' ? 'Daily rate' : 'Monthly'),
              },
              {
                key: 'pay',
                header: 'Basic',
                isNumeric: true,
                render: (employee) => formatKes(employee.basic_pay_cents),
              },
              {
                key: 'status',
                header: 'Status',
                render: (employee) =>
                  employee.is_active ? (
                    <StatusChip tone="success">Active</StatusChip>
                  ) : (
                    <StatusChip tone="neutral">Inactive</StatusChip>
                  ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (employee) =>
                  canEditEmployees(role) ? (
                    <Button variant="ghost" onClick={() => setEditing(employee)}>
                      Edit
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Card>
      </TabPanel>

      <TabPanel id="advances" activeId={view}>
        <div className="rsk-stack">
          {canRequestAdvance(role) ? (
            <Button variant="secondary" onClick={() => setIsRequestingAdvance(true)}>
              Request advance
            </Button>
          ) : null}

          <Card isFlush>
            <Table
              rows={advances}
              getRowKey={(advance) => advance.id}
              empty={
                <EmptyState
                  icon={<Wallet size={20} aria-hidden="true" />}
                  title="No salary advances"
                  description="An approved advance is recovered automatically in the next payroll run."
                />
              }
              columns={[
                { key: 'employee', header: 'Employee', render: (advance) => advance.employeeName },
                {
                  key: 'amount',
                  header: 'Amount',
                  isNumeric: true,
                  render: (advance) => formatKes(advance.amount_cents),
                },
                {
                  key: 'requested',
                  header: 'Requested',
                  render: (advance) => formatDate(advance.requested_at),
                },
                { key: 'status', header: 'Status', render: advanceChip },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (advance) =>
                    canApproveAdvance(role) && advance.status === 'pending' ? (
                      <>
                        <Button variant="ghost" onClick={() => void decide(advance, 'approved')}>
                          Approve
                        </Button>
                        <Button variant="ghost" onClick={() => void decide(advance, 'rejected')}>
                          Reject
                        </Button>
                      </>
                    ) : null,
                },
              ]}
            />
          </Card>
        </div>
      </TabPanel>

      {isAddingEmployee || editing ? (
        <EmployeeForm
          isOpen
          employee={editing}
          onClose={() => {
            setIsAddingEmployee(false)
            setEditing(null)
          }}
          onSubmit={saveEmployee}
        />
      ) : null}

      {isPreparing ? (
        <PrepareRunForm
          employees={employees.filter((employee) => employee.is_active)}
          onClose={() => setIsPreparing(false)}
          onSubmit={async (input) => {
            try {
              const run = await repo.prepareRun({ id: newId(), ...input })
              showToast({
                tone: 'success',
                title: `${periodLabel(run)} prepared`,
                description: `${run.totals.employeeCount} employees, ${formatKes(run.totals.netPayCents)} net.`,
              })
              await reload()
              return {}
            } catch (cause) {
              return {
                error: cause instanceof Error ? cause.message : 'Could not prepare the run.',
              }
            }
          }}
        />
      ) : null}

      {isRequestingAdvance ? (
        <AdvanceForm
          employees={employees.filter((employee) => employee.is_active)}
          onClose={() => setIsRequestingAdvance(false)}
          onSubmit={async (input) => {
            try {
              await repo.requestAdvance({ id: newId(), ...input })
              showToast({ tone: 'success', title: 'Advance requested' })
              await reload()
              return {}
            } catch (cause) {
              return {
                error: cause instanceof Error ? cause.message : 'Could not request the advance.',
              }
            }
          }}
        />
      ) : null}

      {openRun && !payslip ? (
        <Modal
          isOpen
          onClose={() => setOpenRun(null)}
          title={periodLabel(openRun)}
          description={`${openRun.totals.employeeCount} employees · ${formatKes(openRun.totals.netPayCents)} net`}
          size="lg"
        >
          <Table
            rows={openRun.items}
            getRowKey={(item) => item.id}
            empty={<p>This run has no lines.</p>}
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (item) => item.employee_snapshot.full_name,
              },
              {
                key: 'gross',
                header: 'Gross',
                isNumeric: true,
                render: (item) => formatKes(item.gross_cents),
              },
              {
                key: 'deductions',
                header: 'Deductions',
                isNumeric: true,
                render: (item) => formatKes(item.gross_cents - item.net_pay_cents),
              },
              {
                key: 'net',
                header: 'Net pay',
                isNumeric: true,
                render: (item) => formatKes(item.net_pay_cents),
              },
              {
                key: 'payslip',
                header: 'Payslip',
                render: (item) => (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      // A document renders in the browser top layer, above any
                      // z-index, so the modal has to close first.
                      const run = openRun
                      setOpenRun(null)
                      setPayslip({ item, run })
                    }}
                  >
                    Open
                  </Button>
                ),
              },
            ]}
          />
        </Modal>
      ) : null}

      {payslip ? (
        <PayslipDocument
          item={payslip.item}
          run={payslip.run}
          company={company}
          onClose={() => setPayslip(null)}
        />
      ) : null}
      {payingRun ? (
        <PayMpesaDialog
          runId={payingRun.id}
          periodLabel={`Payroll for ${periodLabel(payingRun)}`}
          refreshKey={employeesVersion}
          onClose={() => setPayingRun(null)}
          onRequested={() => void reload()}
          onFixEmployee={(employeeId) => {
            // Opens over the dialog (a later showModal sits on top); closing
            // the form returns to it with the plan re-read.
            const employee = employees.find((candidate) => candidate.id === employeeId)
            if (employee) setEditing(employee)
            else
              showToast({
                tone: 'danger',
                title: 'That employee record is not on this device yet.',
              })
          }}
        />
      ) : null}
    </div>
  )
}

function PrepareRunForm({
  employees,
  onClose,
  onSubmit,
}: {
  employees: readonly Employee[]
  onClose: () => void
  onSubmit: (input: {
    year: number
    month: number
    daysWorked: Record<string, number>
  }) => Promise<{ error?: string }>
}) {
  const now = new Date()
  const [year, setYear] = useState(String(now.getUTCFullYear()))
  const [month, setMonth] = useState(String(now.getUTCMonth() + 1))
  const [daysWorked, setDaysWorked] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const dailyStaff = employees.filter((employee) => employee.salary_type === 'daily')

  async function handleSubmit() {
    setError(null)

    const yearValue = Number(year)
    const monthValue = Number(month)
    if (!Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2999) {
      return setError('Enter a valid year.')
    }

    const days: Record<string, number> = {}
    for (const employee of dailyStaff) {
      const value = Number(daysWorked[employee.id] ?? '0')
      if (!Number.isFinite(value) || value < 0 || value > 31) {
        return setError(`Enter the days worked for ${employee.full_name} (0 to 31).`)
      }
      days[employee.id] = value
    }

    setIsSaving(true)
    const result = await onSubmit({ year: yearValue, month: monthValue, daysWorked: days })
    setIsSaving(false)

    if (result.error) setError(result.error)
    else onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Prepare payroll run"
      description="Computes every active employee at the statutory rates in force, and recovers approved advances."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Preparing' : 'Prepare run'}
          </Button>
        </>
      }
    >
      <div className="rsk-stack">
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <Field label="Year" isRequired>
          <Input
            value={year}
            inputMode="numeric"
            onChange={(event) => setYear(event.target.value)}
          />
        </Field>

        <Field label="Month" isRequired>
          <Select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            options={Array.from({ length: 12 }, (_, index) => ({
              value: String(index + 1),
              label: new Date(Date.UTC(2026, index, 1)).toLocaleString('en-GB', { month: 'long' }),
            }))}
          />
        </Field>

        {dailyStaff.map((employee) => (
          <Field key={employee.id} label={`Days worked — ${employee.full_name}`} isRequired>
            <Input
              value={daysWorked[employee.id] ?? ''}
              inputMode="numeric"
              placeholder="0"
              onChange={(event) =>
                setDaysWorked((current) => ({ ...current, [employee.id]: event.target.value }))
              }
            />
          </Field>
        ))}
      </div>
    </Modal>
  )
}

function AdvanceForm({
  employees,
  onClose,
  onSubmit,
}: {
  employees: readonly Employee[]
  onClose: () => void
  onSubmit: (input: { employeeId: string; amountCents: number }) => Promise<{ error?: string }>
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '')
  const [amount, setAmount] = useState('0.00')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit() {
    setError(null)
    if (!employeeId) return setError('Choose an employee.')

    const amountCents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return setError('Enter an amount greater than zero.')
    }

    setIsSaving(true)
    const result = await onSubmit({ employeeId, amountCents })
    setIsSaving(false)

    if (result.error) setError(result.error)
    else onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Request salary advance"
      description="Recovered automatically from the next payroll run once the owner approves it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving' : 'Request advance'}
          </Button>
        </>
      }
    >
      <div className="rsk-stack">
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <Field label="Employee" isRequired>
          <Select
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            options={employees.map((employee) => ({
              value: employee.id,
              label: employee.full_name,
            }))}
          />
        </Field>

        <Field label="Amount" isRequired>
          <Input
            value={amount}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
