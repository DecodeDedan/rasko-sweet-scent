'use client'

import { useEffect } from 'react'
import { Button, formatDate, formatKes } from '@rasko/ui'

import type { CompanySettings } from '../invoices/types.js'
import type { PayrollItem, PayrollRun } from './types.js'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function periodLabel(run: Pick<PayrollRun, 'period_year' | 'period_month'>): string {
  return `${MONTHS[run.period_month - 1] ?? run.period_month} ${run.period_year}`
}

/**
 * FR-8.6: the branded payslip.
 *
 * Every figure comes from the stored `payroll_items` row, never recomputed —
 * the run froze both the rates and the employee details, so a payslip reprinted
 * next year shows what it showed on payday.
 *
 * It shows its working. An employee who cannot see how gross became net has no
 * way to challenge an error, and an accountant checking the run by hand needs
 * the same intermediate figures the law uses.
 */
export function PayslipDocument({
  item,
  run,
  company,
  onClose,
}: {
  item: PayrollItem
  run: PayrollRun
  company: CompanySettings | null
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const employee = item.employee_snapshot
  const statutory = item.paye_cents + item.nssf_cents + item.shif_cents + item.housing_levy_cents
  const otherDeductions = item.other_deductions.reduce(
    (sum, deduction) => sum + deduction.amount_cents,
    0,
  )

  return (
    <div className="doc-overlay">
      <div className="doc-toolbar rsk-no-print">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>

      <article className="doc-page">
        <header className="doc-header">
          <div>
            <p className="doc-company">{company?.company_name ?? 'Rasko Sweet Scent'}</p>
            {company?.address ? <p className="doc-meta">{company.address}</p> : null}
            {company?.phone ? <p className="doc-meta">{company.phone}</p> : null}
            {company?.kra_pin ? <p className="doc-meta">KRA PIN {company.kra_pin}</p> : null}
          </div>
          <div className="doc-title-block">
            <h1 className="doc-title">Payslip</h1>
            <p className="doc-meta">{periodLabel(run)}</p>
            {item.paid_at ? <p className="doc-meta">Paid {formatDate(item.paid_at)}</p> : null}
          </div>
        </header>

        <div className="doc-rule" />

        <section className="doc-parties">
          <div>
            <p className="doc-label">Employee</p>
            <p className="doc-strong">{employee.full_name}</p>
            {employee.position ? <p className="doc-meta">{employee.position}</p> : null}
            {employee.national_id ? <p className="doc-meta">ID {employee.national_id}</p> : null}
            {employee.kra_pin ? <p className="doc-meta">KRA PIN {employee.kra_pin}</p> : null}
            {employee.nssf_number ? <p className="doc-meta">NSSF {employee.nssf_number}</p> : null}
            {employee.shif_number ? <p className="doc-meta">SHIF {employee.shif_number}</p> : null}
          </div>
          <div>
            <p className="doc-label">Net pay</p>
            <p className="doc-strong rsk-numeric" style={{ textAlign: 'left' }}>
              {formatKes(item.net_pay_cents)}
            </p>
          </div>
        </section>

        <table className="doc-table">
          <thead>
            <tr>
              <th>Earnings</th>
              <th className="rsk-numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {employee.salary_type === 'daily'
                  ? `Basic pay (${item.days_worked ?? 0} days)`
                  : 'Basic pay'}
              </td>
              <td className="rsk-numeric">{formatKes(item.basic_pay_cents)}</td>
            </tr>
            {item.allowances.map((allowance) => (
              <tr key={allowance.code}>
                <td>{allowance.label}</td>
                <td className="rsk-numeric">{formatKes(allowance.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="doc-total-row">
              <td>Gross pay</td>
              <td className="rsk-numeric">{formatKes(item.gross_cents)}</td>
            </tr>
          </tfoot>
        </table>

        <table className="doc-table">
          <thead>
            <tr>
              <th>Deductions</th>
              <th className="rsk-numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>PAYE</td>
              <td className="rsk-numeric">{formatKes(item.paye_cents)}</td>
            </tr>
            <tr>
              <td>NSSF</td>
              <td className="rsk-numeric">{formatKes(item.nssf_cents)}</td>
            </tr>
            <tr>
              <td>SHIF</td>
              <td className="rsk-numeric">{formatKes(item.shif_cents)}</td>
            </tr>
            <tr>
              <td>Housing Levy</td>
              <td className="rsk-numeric">{formatKes(item.housing_levy_cents)}</td>
            </tr>
            {item.advance_deduction_cents > 0 ? (
              <tr>
                <td>Salary advance recovered</td>
                <td className="rsk-numeric">{formatKes(item.advance_deduction_cents)}</td>
              </tr>
            ) : null}
            {item.other_deductions.map((deduction) => (
              <tr key={deduction.label}>
                <td>{deduction.label}</td>
                <td className="rsk-numeric">{formatKes(deduction.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="doc-total-row">
              <td>Total deductions</td>
              <td className="rsk-numeric">
                {formatKes(statutory + item.advance_deduction_cents + otherDeductions)}
              </td>
            </tr>
            <tr className="doc-total-row">
              <td>Net pay</td>
              <td className="rsk-numeric">{formatKes(item.net_pay_cents)}</td>
            </tr>
          </tfoot>
        </table>

        <section>
          <p className="doc-label">How this was calculated</p>
          <p className="doc-meta">
            NSSF, SHIF and the Housing Levy are deducted from gross pay before PAYE is computed.
            Taxable pay for this period was{' '}
            {formatKes(
              item.gross_cents - item.nssf_cents - item.shif_cents - item.housing_levy_cents,
            )}
            .
          </p>
          {item.payment_method ? (
            <p className="doc-meta">
              Paid by {item.payment_method === 'mpesa' ? 'M-Pesa' : 'bank transfer'}
              {item.payment_reference ? `, reference ${item.payment_reference}` : ''}.
            </p>
          ) : null}
        </section>
      </article>
    </div>
  )
}
