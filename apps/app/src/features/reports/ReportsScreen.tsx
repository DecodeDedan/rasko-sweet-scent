'use client'

import { DatabaseZap, Download, FileText, Printer } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  TabPanel,
  Table,
  Tabs,
  formatDate,
  formatMoney,
  useToast,
} from '@rasko/ui'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { downloadCsv } from '../../shell/download.js'
import { toCsv } from '../dashboard/dashboardRepository.js'
import { useCompanySettings } from '../invoices/useInvoices.js'
import type { IncomeStatement } from '../ledger/types.js'
import { currentMonthRange, useLedgerRepository } from '../ledger/useLedger.js'
import { StatementDocument } from './StatementDocument.js'
import { StatementRepository } from './statementRepository.js'
import type { StatementSet } from './statementRepository.js'

type View = 'statement' | 'income'

const TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'statement', label: 'Statement of account' },
  { id: 'income', label: 'Income and expenditure' },
]

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

/** A year-to-date default: statements are usually asked for "since January". */
function yearToDate(): { from: string; to: string } {
  const { to } = currentMonthRange()
  return { from: `${to.slice(0, 4)}-01-01`, to }
}

export function ReportsScreen({ scope }: ScreenProps) {
  const { db } = useSync()
  const identity = useIdentity()
  const ledger = useLedgerRepository()
  const company = useCompanySettings()
  const { showToast } = useToast()

  const statements = useMemo(
    () => (db ? new StatementRepository(db, identity.role) : null),
    [db, identity.role],
  )

  const [view, setView] = useState<View>('statement')
  const [range, setRange] = useState(yearToDate)
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [clientId, setClientId] = useState('')
  const [set, setSet] = useState<StatementSet | null>(null)
  const [income, setIncome] = useState<IncomeStatement[]>([])
  const [isPrinting, setIsPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!statements || !ledger) return
    try {
      setError(null)
      const [nextClients, nextIncome] = await Promise.all([
        statements.clients(),
        ledger.incomeStatement(range),
      ])
      setClients(nextClients)
      setIncome(nextIncome)
      setSet(clientId ? await statements.statement(clientId, range.from, range.to) : null)
    } catch (cause) {
      setError(message(cause, 'Could not build the report.'))
    }
  }, [statements, ledger, range, clientId])

  useSyncedEffect(load)

  if (!statements || !ledger) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Reports" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="Reports are built from the records on the device. Run the installed application to see them."
          />
        </Card>
      </div>
    )
  }

  function exportStatement() {
    if (!set) return
    downloadCsv(
      `statement-${set.client.name}-${set.from}-to-${set.to}.csv`,
      toCsv(
        ['Currency', 'Date', 'Reference', 'Details', 'Debit', 'Credit', 'Balance'],
        set.statements.flatMap((statement) => [
          [
            statement.currency,
            set.from,
            '',
            'Balance brought forward',
            '',
            '',
            statement.opening_cents / 100,
          ],
          ...statement.lines.map((line) => [
            statement.currency,
            line.date,
            line.reference,
            line.description,
            line.debit_cents ? line.debit_cents / 100 : '',
            line.credit_cents ? line.credit_cents / 100 : '',
            line.balance_cents / 100,
          ]),
        ]),
      ),
    )
    showToast({ tone: 'success', title: 'Statement downloaded' })
  }

  function exportIncome() {
    downloadCsv(
      `income-and-expenditure-${range.from}-to-${range.to}.csv`,
      toCsv(
        ['Currency', 'Section', 'Category', 'Amount'],
        income.flatMap((statement) => [
          ...statement.income.map((row) => [
            statement.currency,
            'Income',
            row.category,
            row.amount_cents / 100,
          ]),
          ...statement.expenditure.map((row) => [
            statement.currency,
            'Expenditure',
            row.category,
            row.amount_cents / 100,
          ]),
          [statement.currency, 'Net', '', statement.net_cents / 100],
        ]),
      ),
    )
    showToast({ tone: 'success', title: 'Income and expenditure downloaded' })
  }

  const rangeFields = (
    <>
      <Field label="From">
        <Input
          type="date"
          value={range.from}
          onChange={(event) => setRange({ ...range, from: event.target.value })}
        />
      </Field>
      <Field label="To">
        <Input
          type="date"
          value={range.to}
          onChange={(event) => setRange({ ...range, to: event.target.value })}
        />
      </Field>
    </>
  )

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Reports"
        description="Statements of account for clients, and income and expenditure from the books."
        meta={<ScopeBadge scope={scope} />}
      />

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <Tabs
        items={TABS}
        activeId={view}
        onChange={(id) => setView(id as View)}
        aria-label="Reports"
      />

      <TabPanel id="statement" activeId={view}>
        <div className="rsk-stack">
          <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Client">
              <Select
                value={clientId}
                placeholder="Choose a client"
                onChange={(event) => setClientId(event.target.value)}
                options={clients.map((client) => ({ value: client.id, label: client.name }))}
              />
            </Field>
            {rangeFields}
            <Button
              variant="primary"
              leadingIcon={<Printer size={15} aria-hidden="true" />}
              onClick={() => setIsPrinting(true)}
              disabled={!set}
            >
              Print or save as PDF
            </Button>
            <Button
              variant="secondary"
              leadingIcon={<Download size={15} aria-hidden="true" />}
              onClick={exportStatement}
              disabled={!set}
            >
              Export CSV
            </Button>
          </div>

          {!set ? (
            <Card>
              <EmptyState
                icon={<FileText size={20} aria-hidden="true" />}
                title="Choose a client"
                description="The statement lists every issued invoice, payment and reversal in the period, with the balance brought forward."
              />
            </Card>
          ) : null}

          {set?.statements.length === 0 ? (
            <Card>
              <EmptyState
                icon={<FileText size={20} aria-hidden="true" />}
                title="Nothing on this account yet"
                description="Issue an invoice to this client and it will appear on the statement."
              />
            </Card>
          ) : null}

          {set?.statements.map((statement) => (
            <Card key={statement.currency} isFlush>
              <Table
                rows={[
                  {
                    id: 'opening',
                    date: set.from,
                    reference: '',
                    description: 'Balance brought forward',
                    debit_cents: 0,
                    credit_cents: 0,
                    balance_cents: statement.opening_cents,
                  },
                  ...statement.lines,
                ]}
                getRowKey={(line) => line.id}
                caption={`${statement.currency} account`}
                columns={[
                  { key: 'date', header: 'Date', render: (line) => formatDate(line.date) },
                  { key: 'ref', header: 'Reference', render: (line) => line.reference },
                  { key: 'details', header: 'Details', render: (line) => line.description },
                  {
                    key: 'debit',
                    header: 'Debit',
                    isNumeric: true,
                    render: (line) =>
                      line.debit_cents ? formatMoney(line.debit_cents, statement.currency) : '',
                  },
                  {
                    key: 'credit',
                    header: 'Credit',
                    isNumeric: true,
                    render: (line) =>
                      line.credit_cents ? formatMoney(line.credit_cents, statement.currency) : '',
                  },
                  {
                    key: 'balance',
                    header: 'Balance',
                    isNumeric: true,
                    render: (line) => formatMoney(line.balance_cents, statement.currency),
                  },
                ]}
              />
              <p className="rsk-metric__label" style={{ padding: '0.75rem' }}>
                Balance due at {formatDate(set.to)}:{' '}
                <strong className="rsk-numeric">
                  {formatMoney(statement.closing_cents, statement.currency)}
                </strong>
              </p>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="income" activeId={view}>
        <div className="rsk-stack">
          <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {rangeFields}
            <Button
              variant="secondary"
              leadingIcon={<Download size={15} aria-hidden="true" />}
              onClick={exportIncome}
              disabled={income.length === 0}
            >
              Export CSV
            </Button>
          </div>
          <p className="rsk-metric__label">
            Cash basis: money actually received and paid in the period. Transfers between the
            farm&apos;s own accounts are left out. Each currency is reported on its own.
          </p>

          {income.length === 0 ? (
            <Card>
              <EmptyState
                icon={<FileText size={20} aria-hidden="true" />}
                title="No money moved in this period"
                description="Payments, salaries, supplier payments and ledger entries in the period are summarised here."
              />
            </Card>
          ) : null}

          {income.map((statement) => (
            <div key={statement.currency} className="rsk-stack">
              <div className="rsk-metrics">
                <Card>
                  <p className="rsk-metric__label">Income ({statement.currency})</p>
                  <p className="rsk-metric__value rsk-numeric">
                    {formatMoney(statement.total_income_cents, statement.currency)}
                  </p>
                </Card>
                <Card>
                  <p className="rsk-metric__label">Expenditure ({statement.currency})</p>
                  <p className="rsk-metric__value rsk-numeric">
                    {formatMoney(statement.total_expenditure_cents, statement.currency)}
                  </p>
                </Card>
                <Card>
                  <p className="rsk-metric__label">
                    {statement.net_cents >= 0 ? 'Surplus' : 'Deficit'}
                  </p>
                  <p className="rsk-metric__value rsk-numeric">
                    {formatMoney(Math.abs(statement.net_cents), statement.currency)}
                  </p>
                </Card>
              </div>
              <Card isFlush>
                <Table
                  rows={statement.income}
                  getRowKey={(row) => row.category}
                  caption={`Income, ${statement.currency}`}
                  columns={[
                    { key: 'category', header: 'Category', render: (row) => row.category },
                    {
                      key: 'amount',
                      header: 'Amount',
                      isNumeric: true,
                      render: (row) => formatMoney(row.amount_cents, statement.currency),
                    },
                  ]}
                />
              </Card>
              <Card isFlush>
                <Table
                  rows={statement.expenditure}
                  getRowKey={(row) => row.category}
                  caption={`Expenditure, ${statement.currency}`}
                  columns={[
                    { key: 'category', header: 'Category', render: (row) => row.category },
                    {
                      key: 'amount',
                      header: 'Amount',
                      isNumeric: true,
                      render: (row) => formatMoney(row.amount_cents, statement.currency),
                    },
                  ]}
                />
              </Card>
            </div>
          ))}
        </div>
      </TabPanel>

      {isPrinting && set ? (
        <StatementDocument set={set} company={company} onClose={() => setIsPrinting(false)} />
      ) : null}
    </div>
  )
}
