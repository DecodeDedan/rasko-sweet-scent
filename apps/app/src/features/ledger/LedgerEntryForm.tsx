'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, Select } from '@rasko/ui'

import { toCents } from '../invoices/currency.js'
import { DIRECTION_LABEL } from './types.js'
import type {
  EntryDirection,
  LedgerCategory,
  LedgerEntry,
  MoneyAccount,
  NewLedgerEntry,
} from './types.js'

const DIRECTIONS: readonly EntryDirection[] = ['out', 'in', 'transfer']

interface Props {
  accounts: readonly MoneyAccount[]
  categories: readonly LedgerCategory[]
  entry: LedgerEntry | null
  today: string
  onClose: () => void
  onSubmit: (values: Omit<NewLedgerEntry, 'id'>) => Promise<{ error?: string }>
}

function accountLabel(account: MoneyAccount): string {
  return `${account.name} (${account.currency})`
}

/** Money in, money out, or a move between the farm's own accounts. */
export function LedgerEntryForm({ accounts, categories, entry, today, onClose, onSubmit }: Props) {
  const [direction, setDirection] = useState<EntryDirection>(entry?.direction ?? 'out')
  const [entryDate, setEntryDate] = useState(entry?.entry_date ?? today)
  const [accountId, setAccountId] = useState(entry?.account_id ?? accounts[0]?.id ?? '')
  const [toAccountId, setToAccountId] = useState(entry?.to_account_id ?? '')
  const [categoryId, setCategoryId] = useState(entry?.category_id ?? '')
  const [amount, setAmount] = useState(entry ? (entry.amount_cents / 100).toFixed(2) : '')
  const [party, setParty] = useState(entry?.party ?? '')
  const [reference, setReference] = useState(entry?.reference ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const source = accounts.find((account) => account.id === accountId)
  const facing = categories.filter(
    (category) => direction !== 'transfer' && category.direction === direction,
  )
  const targets = accounts.filter(
    (account) => account.id !== accountId && account.currency === source?.currency,
  )

  async function handleSubmit() {
    setError(null)
    const amountCents = toCents(amount)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return setError('Enter an amount greater than zero.')
    }
    setIsSaving(true)
    const result = await onSubmit({
      entryDate,
      direction,
      accountId,
      toAccountId: direction === 'transfer' ? toAccountId || null : null,
      categoryId: direction === 'transfer' ? null : categoryId || null,
      amountCents,
      party: party.trim() || null,
      reference: reference.trim() || null,
      description,
    })
    setIsSaving(false)
    if (result.error) setError(result.error)
    else onClose()
  }

  const accountField = direction === 'in' ? 'Into account' : 'From account'

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={entry ? 'Correct entry' : 'Record money in or out'}
      description="Sales receipts, supplier payments and salaries appear in the books on their own. Record everything else here."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} isLoading={isSaving}>
            {entry ? 'Save correction' : 'Record entry'}
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

        <Field label="Type" isRequired>
          <Select
            value={direction}
            onChange={(event) => {
              setDirection(event.target.value as EntryDirection)
              setCategoryId('')
            }}
            options={DIRECTIONS.map((value) => ({ value, label: DIRECTION_LABEL[value] }))}
          />
        </Field>

        <Field label="Date" isRequired>
          <Input
            type="date"
            value={entryDate}
            onChange={(event) => setEntryDate(event.target.value)}
          />
        </Field>

        <Field label={direction === 'transfer' ? 'From account' : accountField} isRequired>
          <Select
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value)
              setToAccountId('')
            }}
            options={accounts.map((account) => ({
              value: account.id,
              label: accountLabel(account),
            }))}
          />
        </Field>

        {direction === 'transfer' ? (
          <Field label="Into account" isRequired hint="Transfers stay within one currency.">
            <Select
              value={toAccountId}
              placeholder="Choose an account"
              onChange={(event) => setToAccountId(event.target.value)}
              options={targets.map((account) => ({
                value: account.id,
                label: accountLabel(account),
              }))}
            />
          </Field>
        ) : (
          <Field label="Category" isRequired>
            <Select
              value={categoryId}
              placeholder="Choose a category"
              onChange={(event) => setCategoryId(event.target.value)}
              options={facing.map((category) => ({ value: category.id, label: category.name }))}
            />
          </Field>
        )}

        <Field label={`Amount${source ? ` (${source.currency})` : ''}`} isRequired>
          <Input
            value={amount}
            inputMode="decimal"
            isNumeric
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        <Field label="What it was for" isRequired>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>

        {direction !== 'transfer' ? (
          <Field label={direction === 'in' ? 'Received from' : 'Paid to'}>
            <Input value={party} onChange={(event) => setParty(event.target.value)} />
          </Field>
        ) : null}

        <Field label="Reference" hint="M-Pesa code, receipt or cheque number.">
          <Input value={reference} onChange={(event) => setReference(event.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
