'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, Select } from '@rasko/ui'

import { toCents } from '../invoices/currency.js'
import { ACCOUNT_KINDS, ACCOUNT_KIND_LABEL } from './types.js'
import type { AccountKind, MoneyAccount, MoneyAccountInput } from './types.js'

interface Props {
  account: MoneyAccount | null
  today: string
  onClose: () => void
  onSubmit: (values: Omit<MoneyAccountInput, 'id'>) => Promise<{ error?: string }>
}

/** Where money is kept: a till, the M-Pesa line, a bank account. Owner only. */
export function MoneyAccountForm({ account, today, onClose, onSubmit }: Props) {
  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'bank')
  const [currency, setCurrency] = useState(account?.currency ?? 'KES')
  const [opening, setOpening] = useState(
    account ? (account.opening_balance_cents / 100).toFixed(2) : '0.00',
  )
  const [openingDate, setOpeningDate] = useState(account?.opening_date ?? today)
  const [isDefault, setIsDefault] = useState(account?.is_default ?? false)
  const [details, setDetails] = useState(account?.details ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit() {
    setError(null)
    const openingBalanceCents = toCents(opening)
    if (!Number.isFinite(openingBalanceCents)) return setError('Enter a valid opening balance.')
    setIsSaving(true)
    const result = await onSubmit({
      name,
      kind,
      currency,
      openingBalanceCents,
      openingDate,
      isDefault,
      details: details.trim() || null,
    })
    setIsSaving(false)
    if (result.error) setError(result.error)
    else onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={account ? 'Edit account' : 'Add account'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} isLoading={isSaving}>
            Save account
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

        <Field label="Name" isRequired hint="For example: Equity Bank current account.">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <Field label="Kind" isRequired>
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as AccountKind)}
            options={ACCOUNT_KINDS.map((value) => ({ value, label: ACCOUNT_KIND_LABEL[value] }))}
          />
        </Field>

        <Field label="Currency" isRequired hint="Three letters, for example KES or USD.">
          <Input
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </Field>

        <Field
          label="Opening balance"
          isRequired
          hint="What the account held at the start of the opening date. Earlier entries are not added again."
        >
          <Input
            value={opening}
            inputMode="decimal"
            isNumeric
            onChange={(event) => setOpening(event.target.value)}
          />
        </Field>

        <Field label="Opening date" isRequired>
          <Input
            type="date"
            value={openingDate}
            onChange={(event) => setOpeningDate(event.target.value)}
          />
        </Field>

        <label className="rsk-row">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
          />
          <span>
            Default {ACCOUNT_KIND_LABEL[kind]} account for {currency || 'this currency'}: payments
            recorded by {ACCOUNT_KIND_LABEL[kind]} land here
          </span>
        </label>

        <Field label="Details" hint="Account number, branch, till or paybill.">
          <Input value={details} onChange={(event) => setDetails(event.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
