'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, Select, formatKes } from '@rasko/ui'

import { SUPPLIER_PAYMENT_METHODS, SUPPLIER_PAYMENT_METHOD_LABEL } from './types.js'
import type { PurchaseSummary, SupplierPaymentMethod } from './types.js'

function toCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN
}

export function SupplierPaymentForm({
  isOpen,
  onClose,
  purchase,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  purchase: PurchaseSummary
  onSubmit: (values: {
    amountCents: number
    method: SupplierPaymentMethod
    reference: string | null
    paidAt: string
  }) => Promise<{ error?: string }>
}) {
  // Defaults to the full balance: paying a supplier in full is the common case.
  const [amount, setAmount] = useState((purchase.balanceCents / 100).toFixed(2))
  const [method, setMethod] = useState<SupplierPaymentMethod>('mpesa')
  const [reference, setReference] = useState('')
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))

  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit() {
    setError(null)

    const amountCents = toCents(amount)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return setError('Enter an amount greater than zero.')
    }
    if (amountCents > purchase.balanceCents) {
      return setError(`That is more than the ${formatKes(purchase.balanceCents)} still owed.`)
    }

    setIsSaving(true)
    const result = await onSubmit({
      amountCents,
      method,
      reference: reference.trim() || null,
      paidAt: new Date(`${paidAt}T00:00:00.000Z`).toISOString(),
    })
    setIsSaving(false)

    if (result.error) setError(result.error)
    else onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record supplier payment"
      description={`${purchase.supplierName} — ${formatKes(purchase.balanceCents)} owed`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving' : 'Record payment'}
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

        <Field label="Amount" isRequired>
          <Input
            value={amount}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        <Field label="Method" isRequired>
          <Select
            value={method}
            onChange={(event) => setMethod(event.target.value as SupplierPaymentMethod)}
            options={SUPPLIER_PAYMENT_METHODS.map((value) => ({
              value,
              label: SUPPLIER_PAYMENT_METHOD_LABEL[value],
            }))}
          />
        </Field>

        <Field label="Reference" hint="M-Pesa code, cheque number or bank reference.">
          <Input value={reference} onChange={(event) => setReference(event.target.value)} />
        </Field>

        <Field label="Paid on" isRequired>
          <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
