'use client'

import { formatDate, formatMoney, formatPhone } from '@rasko/ui'

import { DocumentOverlay } from '../../shell/DocumentOverlay.js'
import { pdfFileName } from '../../shell/print.js'
import type { CompanySettings } from '../invoices/types.js'
import type { Statement, StatementSet } from './statementRepository.js'

const AGING_COLUMNS: ReadonlyArray<{ key: keyof Statement['aging']; label: string }> = [
  { key: 'current_cents', label: 'Not yet due' },
  { key: 'days_1_30_cents', label: '1–30 days' },
  { key: 'days_31_60_cents', label: '31–60 days' },
  { key: 'days_61_90_cents', label: '61–90 days' },
  { key: 'days_over_90_cents', label: 'Over 90 days' },
]

/**
 * A4 statement of account, ink on white, printed through the same overlay as
 * every other document (shell/DocumentOverlay.tsx). One section per currency.
 */
export function StatementDocument({
  set,
  company,
  onClose,
}: {
  set: StatementSet
  company: CompanySettings | null
  onClose: () => void
}) {
  const { client } = set
  return (
    <DocumentOverlay
      onClose={onClose}
      fileName={pdfFileName(['Statement of account', client.name], `${set.from} to ${set.to}`)}
    >
      <article className="doc-page">
        <header className="doc-header">
          <div>
            <p className="doc-company">{company?.company_name ?? 'Rasko Sweet Scent'}</p>
            {company?.address ? <p className="doc-meta">{company.address}</p> : null}
            {company?.phone ? <p className="doc-meta">{formatPhone(company.phone)}</p> : null}
            {company?.email ? <p className="doc-meta">{company.email}</p> : null}
            {company?.kra_pin ? <p className="doc-meta">KRA PIN {company.kra_pin}</p> : null}
          </div>
          <div className="doc-title-block">
            <h1 className="doc-title">Statement of account</h1>
            <p className="doc-meta">
              {formatDate(set.from)} to {formatDate(set.to)}
            </p>
          </div>
        </header>

        <div className="doc-rule" />

        <section className="doc-parties">
          <div>
            <p className="doc-label">Account</p>
            <p className="doc-strong">{client.name}</p>
            {client.address ? <p className="doc-meta">{client.address}</p> : null}
            {client.phone ? <p className="doc-meta">{formatPhone(client.phone)}</p> : null}
            {client.email ? <p className="doc-meta">{client.email}</p> : null}
            {client.kra_pin ? <p className="doc-meta">KRA PIN {client.kra_pin}</p> : null}
          </div>
          <div>
            <p className="doc-label">Balance due</p>
            {set.statements.length === 0 ? <p className="doc-strong">Nothing owed</p> : null}
            {set.statements.map((statement) => (
              <p key={statement.currency} className="doc-strong rsk-numeric">
                {formatMoney(statement.closing_cents, statement.currency)}
              </p>
            ))}
          </div>
        </section>

        {set.statements.length === 0 ? (
          <p className="doc-meta">
            No invoices or payments on this account up to {formatDate(set.to)}.
          </p>
        ) : null}

        {set.statements.map((statement) => (
          <section key={statement.currency}>
            {set.statements.length > 1 ? (
              <p className="doc-label">{statement.currency} account</p>
            ) : null}
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Details</th>
                  <th className="rsk-numeric">Debit</th>
                  <th className="rsk-numeric">Credit</th>
                  <th className="rsk-numeric">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{formatDate(set.from)}</td>
                  <td />
                  <td>Balance brought forward</td>
                  <td />
                  <td />
                  <td className="rsk-numeric">
                    {formatMoney(statement.opening_cents, statement.currency)}
                  </td>
                </tr>
                {statement.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{formatDate(line.date)}</td>
                    <td>{line.reference}</td>
                    <td>{line.description}</td>
                    <td className="rsk-numeric">
                      {line.debit_cents ? formatMoney(line.debit_cents, statement.currency) : ''}
                    </td>
                    <td className="rsk-numeric">
                      {line.credit_cents ? formatMoney(line.credit_cents, statement.currency) : ''}
                    </td>
                    <td className="rsk-numeric">
                      {formatMoney(line.balance_cents, statement.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Totals for the period</td>
                  <td className="rsk-numeric">
                    {formatMoney(statement.total_debit_cents, statement.currency)}
                  </td>
                  <td className="rsk-numeric">
                    {formatMoney(statement.total_credit_cents, statement.currency)}
                  </td>
                  <td />
                </tr>
                <tr className="doc-total-row">
                  <td colSpan={5}>Balance due at {formatDate(set.to)}</td>
                  <td className="rsk-numeric">
                    {formatMoney(statement.closing_cents, statement.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>

            <table className="doc-table">
              <thead>
                <tr>
                  {AGING_COLUMNS.map((column) => (
                    <th key={column.key} className="rsk-numeric">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {AGING_COLUMNS.map((column) => (
                    <td key={column.key} className="rsk-numeric">
                      {formatMoney(statement.aging[column.key], statement.currency)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>
        ))}

        <footer className="doc-footer">
          {company?.mpesa_paybill ? (
            <p className="doc-meta">
              Pay by M-Pesa: Paybill {company.mpesa_paybill}
              {company.mpesa_paybill_account ? `, account ${company.mpesa_paybill_account}` : ''}.
            </p>
          ) : null}
          <p className="doc-meta">
            Please tell us of any difference. Payments received after {formatDate(set.to)} are not
            shown.
          </p>
        </footer>
      </article>
    </DocumentOverlay>
  )
}
