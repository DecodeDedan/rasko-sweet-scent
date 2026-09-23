import type { Role } from '../../auth/session.js'
import type { Allowance, OtherDeduction, RatesSnapshot } from './statutory.js'

export type SalaryType = 'monthly' | 'daily'
export type PaymentMethod = 'mpesa' | 'bank'

export type AdvanceStatus = 'pending' | 'approved' | 'rejected' | 'recovered'
export type PayrollRunStatus = 'draft' | 'prepared' | 'approved' | 'paid' | 'cancelled'

export const RUN_STATUS_LABEL: Record<PayrollRunStatus, string> = {
  draft: 'Draft',
  prepared: 'Prepared',
  approved: 'Approved',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

export const ADVANCE_STATUS_LABEL: Record<AdvanceStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  recovered: 'Recovered',
}

/**
 * FR-8.8 / PRD §3.1: owner full, manager view-only, accountant prepares, sales
 * never. These mirror the RLS policies; the server refuses regardless.
 */
export function canSeePayroll(role: Role): boolean {
  return role === 'owner' || role === 'manager' || role === 'accountant'
}

/** Accountant prepares, owner does everything. Manager is read-only (FR-8.8). */
export function canPreparePayroll(role: Role): boolean {
  return role === 'owner' || role === 'accountant'
}

/** FR-8.5: approval is the owner's alone, mirrored by `app.guard_payroll_approval`. */
export function canApprovePayroll(role: Role): boolean {
  return role === 'owner'
}

/** FR-8.3: manager or owner may request an advance; only the owner approves it. */
export function canRequestAdvance(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

export function canApproveAdvance(role: Role): boolean {
  return role === 'owner'
}

/** Employee records are personal data under the Data Protection Act 2019. */
export function canEditEmployees(role: Role): boolean {
  return role === 'owner'
}

const NEXT_RUN: Record<PayrollRunStatus, readonly PayrollRunStatus[]> = {
  draft: ['prepared', 'cancelled'],
  prepared: ['approved', 'cancelled'],
  approved: ['paid'],
  paid: [],
  cancelled: [],
}

export function nextRunStatuses(from: PayrollRunStatus): readonly PayrollRunStatus[] {
  return NEXT_RUN[from]
}

export function canTransitionRun(from: PayrollRunStatus, to: PayrollRunStatus): boolean {
  return NEXT_RUN[from].includes(to)
}

export interface Employee {
  id: string
  profile_id: string | null
  full_name: string
  national_id: string
  kra_pin: string | null
  nssf_number: string | null
  shif_number: string | null
  phone: string | null
  position: string | null
  salary_type: SalaryType
  basic_pay_cents: number
  allowances: Allowance[]
  payment_method: PaymentMethod | null
  payment_details: Record<string, unknown> | null
  is_active: boolean
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

export interface Advance {
  id: string
  employee_id: string
  employeeName: string
  amount_cents: number
  requested_at: string
  requested_by: string | null
  status: AdvanceStatus
  approved_at: string | null
  approved_by: string | null
  recovered_in_run_id: string | null
}

export interface PayrollRun {
  id: string
  period_year: number
  period_month: number
  status: PayrollRunStatus
  prepared_at: string | null
  prepared_by: string | null
  approved_at: string | null
  approved_by: string | null
  rates_snapshot: RatesSnapshot
  totals: PayrollTotals
  created_at: string | null
  updated_at: string | null
}

export interface PayrollTotals {
  employeeCount: number
  grossCents: number
  payeCents: number
  nssfCents: number
  shifCents: number
  housingLevyCents: number
  advanceCents: number
  netPayCents: number
}

export const EMPTY_TOTALS: PayrollTotals = {
  employeeCount: 0,
  grossCents: 0,
  payeCents: 0,
  nssfCents: 0,
  shifCents: 0,
  housingLevyCents: 0,
  advanceCents: 0,
  netPayCents: 0,
}

export interface PayrollItem {
  id: string
  payroll_run_id: string
  employee_id: string
  employee_snapshot: EmployeeSnapshot
  days_worked: number | null
  basic_pay_cents: number
  allowances: Allowance[]
  gross_cents: number
  paye_cents: number
  nssf_cents: number
  shif_cents: number
  housing_levy_cents: number
  advance_deduction_cents: number
  other_deductions: OtherDeduction[]
  net_pay_cents: number
  paid_at: string | null
  payment_method: PaymentMethod | null
  payment_reference: string | null
}

/** Frozen at preparation so a payslip never changes when the employee record does. */
export interface EmployeeSnapshot {
  full_name: string
  national_id: string
  kra_pin: string | null
  nssf_number: string | null
  shif_number: string | null
  position: string | null
  salary_type: SalaryType
  payment_method: PaymentMethod | null
}

export interface PayrollRunDetail extends PayrollRun {
  items: PayrollItem[]
}

export type PayrollView = 'runs' | 'employees' | 'advances'
