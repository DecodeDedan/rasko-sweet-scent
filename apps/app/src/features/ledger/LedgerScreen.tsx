'use client'

import { BookOpenCheck, DatabaseZap, Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusChip,
  TabPanel,
  Table,
  Tabs,
  formatDate,
  formatMoney,
  useToast,
} from '@rasko/ui'

import { newId } from '../../data/ids.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { downloadCsv } from '../../shell/download.js'
import { toCsv } from '../dashboard/dashboardRepository.js'
import { IntasendPanel } from './IntasendPanel.js'
import { LedgerEntryForm } from './LedgerEntryForm.js'
import { MoneyAccountForm } from './MoneyAccountForm.js'
import {
  ACCOUNT_KIND_LABEL,
  CASH_SOURCE_LABEL,
  canCorrectLedger,
  canManageAccounts,
  canRecordLedger,
} from './types.js'
import type {
  CashBook,
  CashBookLine,
  LedgerCategory,
  LedgerEntry,
  MoneyAccount,
  MoneyAccountBalance,
} from './types.js'
import { currentMonthRange, useLedgerRepository } from './useLedger.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type View = 'book' | 'intasend' | 'accounts' | 'categories'

const TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'book', label: 'Cash book' },
  { id: 'intasend', label: 'IntaSend' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'categories', label: 'Categories' },
]

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

export function LedgerScreen({ role, scope }: ScreenProps) {
  const repo = useLedgerRepository()
  const { showToast } = useToast()
  const [view, setView] = useState<View>('book')
  const [range, setRange] = useState(currentMonthRange)
  const [accountId, setAccountId] = useState('')

  const [balances, setBalances] = useState<MoneyAccountBalance[]>([])
  const [unassigned, setUnassigned] = useState<
    Array<{ currency: string; count: number; net_cents: number }>
  >([])
  const [categories, setCategories] = useState<LedgerCategory[]>([])
  const [book, setBook] = useState<CashBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [entryForm, setEntryForm] = useState<{ entry: LedgerEntry | null } | null>(null)
  const [accountForm, setAccountForm] = useState<{ account: MoneyAccount | null } | null>(null)
  const [newCategory, setNewCategory] = useState({ name: '', direction: 'out' as 'in' | 'out' })

  // Only the latest load may write state: switching accounts quickly must
  // never leave an earlier account's book on screen.
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    const ticket = ++latestLoad.current
    if (!repo) {
      setIsLoading(false)
      return
    }
    try {
      setError(null)
      const [nextBalances, nextUnassigned, nextCategories] = await Promise.all([
        repo.accountBalances(),
        repo.unassigned(),
        repo.listCategories(true),
      ])
      const selected = accountId || nextBalances[0]?.id
      // A half-typed date is not an error worth replacing the screen with.
      const isRangeValid =
        ISO_DATE.test(range.from) && ISO_DATE.test(range.to) && range.from <= range.to
      const nextBook = selected && isRangeValid ? await repo.cashBook(selected, range) : null
      if (ticket !== latestLoad.current) return
      setBalances(nextBalances)
      setUnassigned(nextUnassigned)
      setCategories(nextCategories)
      setBook(nextBook)
      if (!accountId && selected) setAccountId(selected)
    } catch (cause) {
      if (ticket === latestLoad.current) setError(message(cause, 'Could not read the books.'))
    } finally {
      if (ticket === latestLoad.current) setIsLoading(false)
    }
  }, [repo, range, accountId])

  useSyncedEffect(load)

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Ledger" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="The books are held on the device. Run the installed application to see them."
          />
        </Card>
      </div>
    )
  }

  const ledger = repo
  const today = currentMonthRange().to
  const canRecord = canRecordLedger(role)
  const canCorrect = canCorrectLedger(role)
  const canManage = canManageAccounts(role)
  const activeCategories = categories.filter((category) => category.is_active)

  async function openCorrection(line: CashBookLine) {
    try {
      const entry = await ledger.findEntry(line.source_id)
      if (entry) setEntryForm({ entry })
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not open the entry',
        description: message(cause, ''),
      })
    }
  }

  async function removeEntry(line: CashBookLine) {
    if (!window.confirm(`Delete "${line.description}"? The deletion is kept in the audit log.`))
      return
    try {
      await ledger.removeEntry(line.source_id)
      showToast({ tone: 'success', title: 'Entry deleted' })
      await load()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not delete the entry',
        description: message(cause, ''),
      })
    }
  }

  function exportBook() {
    if (!book) return
    downloadCsv(
      `cash-book-${book.account?.name ?? 'account'}-${range.from}-to-${range.to}.csv`,
      toCsv(
        [
          'Date',
          'Description',
          'Party',
          'Source',
          'Category',
          'Reference',
          'In',
          'Out',
          'Balance',
          'Currency',
        ],
        [
          [
            range.from,
            'Balance brought forward',
            '',
            '',
            '',
            '',
            '',
            '',
            book.opening_cents / 100,
            book.currency,
          ],
          ...book.lines.map((line) => [
            line.entry_date,
            line.description,
            line.party ?? '',
            CASH_SOURCE_LABEL[line.source],
            line.category,
            line.reference ?? '',
            line.amount_cents > 0 ? line.amount_cents / 100 : '',
            line.amount_cents < 0 ? -line.amount_cents / 100 : '',
            line.balance_cents / 100,
            line.currency,
          ]),
        ],
      ),
    )
    showToast({ tone: 'success', title: 'Cash book downloaded' })
  }

  async function addCategory() {
    try {
      await ledger.addCategory(newId(), newCategory.name, newCategory.direction)
      setNewCategory({ name: '', direction: newCategory.direction })
      showToast({ tone: 'success', title: 'Category added' })
      await load()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not add the category',
        description: message(cause, ''),
      })
    }
  }

  async function toggleCategory(category: LedgerCategory) {
    try {
      await ledger.setCategoryActive(category.id, !category.is_active)
      await load()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not change the category',
        description: message(cause, ''),
      })
    }
  }

  const currency = book?.currency ?? 'KES'

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Ledger"
        description="Every shilling in and out: client payments, supplier payments, salaries, casual labour and the expenses recorded here."
        meta={<ScopeBadge scope={scope} />}
        actions={
          canRecord && balances.length > 0 ? (
            <Button
              variant="primary"
              leadingIcon={<Plus size={15} aria-hidden="true" />}
              onClick={() => setEntryForm({ entry: null })}
            >
              Record money in or out
            </Button>
          ) : null
        }
      />

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {unassigned.length > 0 ? (
        <Card>
          <p className="rsk-metric__label">Not yet in any account</p>
          {unassigned.map((row) => (
            <p key={row.currency}>
              {row.count} {row.count === 1 ? 'payment' : 'payments'} in {row.currency} (
              {formatMoney(row.net_cents, row.currency)}) have no default {row.currency} account.
              {canManage
                ? ' Add one under Accounts to include them in the books.'
                : ' Ask the owner to add one.'}
            </p>
          ))}
        </Card>
      ) : null}

      <div className="rsk-metrics">
        {balances.map((account) => (
          <Card key={account.id}>
            <p className="rsk-metric__label">
              {account.name} · {ACCOUNT_KIND_LABEL[account.kind]}
            </p>
            <p className="rsk-metric__value rsk-numeric">
              {formatMoney(account.balance_cents, account.currency)}
            </p>
          </Card>
        ))}
      </div>

      <Tabs
        items={TABS}
        activeId={view}
        onChange={(id) => setView(id as View)}
        aria-label="Ledger views"
      />

      <TabPanel id="book" activeId={view}>
        <div className="rsk-stack">
          <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Account">
              <Select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                options={balances.map((account) => ({
                  value: account.id,
                  label: `${account.name} (${account.currency})`,
                }))}
              />
            </Field>
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
            <Button
              variant="secondary"
              leadingIcon={<Download size={15} aria-hidden="true" />}
              onClick={exportBook}
              disabled={!book}
            >
              Export CSV
            </Button>
          </div>

          {book ? (
            <div className="rsk-metrics">
              <Card>
                <p className="rsk-metric__label">Brought forward {formatDate(range.from)}</p>
                <p className="rsk-metric__value rsk-numeric">
                  {formatMoney(book.opening_cents, currency)}
                </p>
              </Card>
              <Card>
                <p className="rsk-metric__label">Money in</p>
                <p className="rsk-metric__value rsk-numeric">
                  {formatMoney(
                    book.lines.reduce((sum, line) => sum + Math.max(0, line.amount_cents), 0),
                    currency,
                  )}
                </p>
              </Card>
              <Card>
                <p className="rsk-metric__label">Money out</p>
                <p className="rsk-metric__value rsk-numeric">
                  {formatMoney(
                    book.lines.reduce((sum, line) => sum + Math.max(0, -line.amount_cents), 0),
                    currency,
                  )}
                </p>
              </Card>
              <Card>
                <p className="rsk-metric__label">Balance {formatDate(range.to)}</p>
                <p className="rsk-metric__value rsk-numeric">
                  {formatMoney(book.closing_cents, currency)}
                </p>
              </Card>
            </div>
          ) : null}

          <Card isFlush>
            <Table
              rows={book?.lines ?? []}
              getRowKey={(line) => line.id}
              caption="Cash book"
              empty={
                <EmptyState
                  icon={<BookOpenCheck size={20} aria-hidden="true" />}
                  title={isLoading ? 'Reading the books' : 'Nothing moved in this period'}
                  description="Client payments, supplier payments, paid salaries and recorded expenses for this account appear here."
                />
              }
              columns={[
                { key: 'date', header: 'Date', render: (line) => formatDate(line.entry_date) },
                {
                  key: 'what',
                  header: 'Description',
                  render: (line) => (
                    <>
                      <span>{line.description}</span>
                      {line.party ? <span className="rsk-metric__label">{line.party}</span> : null}
                    </>
                  ),
                },
                {
                  key: 'source',
                  header: 'Source',
                  render: (line) => (
                    <StatusChip tone={line.source === 'ledger' ? 'neutral' : 'success'}>
                      {line.source === 'ledger' ? line.category : CASH_SOURCE_LABEL[line.source]}
                    </StatusChip>
                  ),
                },
                { key: 'ref', header: 'Reference', render: (line) => line.reference ?? '' },
                {
                  key: 'in',
                  header: 'In',
                  isNumeric: true,
                  render: (line) =>
                    line.amount_cents > 0 ? formatMoney(line.amount_cents, line.currency) : '',
                },
                {
                  key: 'out',
                  header: 'Out',
                  isNumeric: true,
                  render: (line) =>
                    line.amount_cents < 0 ? formatMoney(-line.amount_cents, line.currency) : '',
                },
                {
                  key: 'balance',
                  header: 'Balance',
                  isNumeric: true,
                  render: (line) => formatMoney(line.balance_cents, line.currency),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (line) =>
                    line.source === 'ledger' && canCorrect ? (
                      <span className="rsk-row">
                        <Button
                          variant="ghost"
                          aria-label={`Correct ${line.description}`}
                          onClick={() => void openCorrection(line)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Delete ${line.description}`}
                          onClick={() => void removeEntry(line)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      </span>
                    ) : null,
                },
              ]}
            />
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="accounts" activeId={view}>
        <div className="rsk-stack">
          {canManage ? (
            <Button
              variant="secondary"
              leadingIcon={<Plus size={15} aria-hidden="true" />}
              onClick={() => setAccountForm({ account: null })}
            >
              Add account
            </Button>
          ) : null}
          <Card isFlush>
            <Table
              rows={balances}
              getRowKey={(account) => account.id}
              caption="Money accounts"
              empty={
                <EmptyState
                  icon={<BookOpenCheck size={20} aria-hidden="true" />}
                  title="No money accounts yet"
                  description="Accounts arrive with the first sync. The owner can add a till, M-Pesa line or bank account."
                />
              }
              columns={[
                { key: 'name', header: 'Account', render: (account) => account.name },
                {
                  key: 'kind',
                  header: 'Kind',
                  render: (account) => ACCOUNT_KIND_LABEL[account.kind],
                },
                {
                  key: 'default',
                  header: 'Payments land here',
                  render: (account) =>
                    account.is_default ? <StatusChip tone="success">Default</StatusChip> : null,
                },
                {
                  key: 'opening',
                  header: 'Opening',
                  isNumeric: true,
                  render: (account) =>
                    `${formatMoney(account.opening_balance_cents, account.currency)} on ${formatDate(account.opening_date)}`,
                },
                {
                  key: 'in',
                  header: 'In since',
                  isNumeric: true,
                  render: (account) => formatMoney(account.money_in_cents, account.currency),
                },
                {
                  key: 'out',
                  header: 'Out since',
                  isNumeric: true,
                  render: (account) => formatMoney(account.money_out_cents, account.currency),
                },
                {
                  key: 'balance',
                  header: 'Balance',
                  isNumeric: true,
                  render: (account) => formatMoney(account.balance_cents, account.currency),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (account) =>
                    canManage ? (
                      <Button variant="ghost" onClick={() => setAccountForm({ account })}>
                        Edit
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="intasend" activeId={view}>
        {view === 'intasend' ? <IntasendPanel repo={ledger} /> : null}
      </TabPanel>

      <TabPanel id="categories" activeId={view}>
        <div className="rsk-stack">
          {canCorrect ? (
            <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="New category">
                <Input
                  value={newCategory.name}
                  onChange={(event) => setNewCategory({ ...newCategory, name: event.target.value })}
                />
              </Field>
              <Field label="For">
                <Select
                  value={newCategory.direction}
                  onChange={(event) =>
                    setNewCategory({
                      ...newCategory,
                      direction: event.target.value as 'in' | 'out',
                    })
                  }
                  options={[
                    { value: 'out', label: 'Money out' },
                    { value: 'in', label: 'Money in' },
                  ]}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={() => void addCategory()}
                disabled={!newCategory.name.trim()}
              >
                Add category
              </Button>
            </div>
          ) : null}
          <Card isFlush>
            <Table
              rows={categories}
              getRowKey={(category) => category.id}
              caption="Ledger categories"
              columns={[
                { key: 'name', header: 'Category', render: (category) => category.name },
                {
                  key: 'direction',
                  header: 'For',
                  render: (category) => (category.direction === 'in' ? 'Money in' : 'Money out'),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (category) =>
                    category.is_active ? (
                      <StatusChip tone="success">In use</StatusChip>
                    ) : (
                      <StatusChip tone="neutral">Retired</StatusChip>
                    ),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (category) =>
                    canCorrect ? (
                      <Button variant="ghost" onClick={() => void toggleCategory(category)}>
                        {category.is_active ? 'Retire' : 'Restore'}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        </div>
      </TabPanel>

      {entryForm ? (
        <LedgerEntryForm
          accounts={balances}
          categories={activeCategories}
          entry={entryForm.entry}
          today={today}
          onClose={() => setEntryForm(null)}
          onSubmit={async (values) => {
            try {
              if (entryForm.entry) await ledger.correctEntry({ ...values, id: entryForm.entry.id })
              else await ledger.recordEntry({ ...values, id: newId() })
              showToast({
                tone: 'success',
                title: entryForm.entry ? 'Entry corrected' : 'Entry recorded',
              })
              await load()
              return {}
            } catch (cause) {
              return { error: message(cause, 'Could not save the entry.') }
            }
          }}
        />
      ) : null}

      {accountForm ? (
        <MoneyAccountForm
          account={accountForm.account}
          today={today}
          onClose={() => setAccountForm(null)}
          onSubmit={async (values) => {
            try {
              await ledger.saveAccount({ ...values, id: accountForm.account?.id ?? newId() })
              showToast({ tone: 'success', title: 'Account saved' })
              await load()
              return {}
            } catch (cause) {
              return { error: message(cause, 'Could not save the account.') }
            }
          }}
        />
      ) : null}
    </div>
  )
}
