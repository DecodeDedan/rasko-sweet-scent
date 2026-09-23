'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, Select, formatKes } from '@rasko/ui'

import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from './types.js'
import type { PaymentMethod } from './types.js'

/** FR-5.3. Amounts are entered in shillings and stored as integer cents. */
function toCents(input: string): number {
  const value = Number(input)
  if (!Number.isFinite(value)) return Number.NaN
  return Math.round(value * 100)
}

export interface PaymentFormProps {
  isOpen: boolean
  onClose: () => void
  balanceCents: number
  onSubmit: (values: {
    amountCents: number
    method: PaymentMethod
    reference: string | null
    paidAt: string
    notes: string | null
  }) => Promise<{ error?: string }>
}

export function PaymentForm({ isOpen, onClose, balanceCents, onSubmit }: PaymentFormProps) {
  const [amount, setAmount] = useState((balanceCents / 100).toFixed(2))
  const [method, setMethod] = useState<PaymentMethod>('mpesa')
  const [reference, setReference] = useState('')
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit() {
    setError(null)
    const cents = toCents(amount)

    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    // M-Pesa and bank transfers have a reference; cash usually does not.
    if ((method === 'mpesa' || method === 'bank_transfer') && !reference.trim()) {
      setError(`Enter the ${PAYMENT_METHOD_LABEL[method]} reference.`)
      return
    }

    setIsSaving(true)
    const result = await onSubmit({
      amountCents: cents,
      method,
      reference: reference.trim() || null,
      paidAt: new Date(paidAt).toISOString(),
      notes: notes.trim() || null,
    })
    setIsSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record a payment"
      description={`Balance outstanding: ${formatKes(balanceCents)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            Record payment
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

        <Field label="Amount in shillings" isRequired hint="Part payments are fine.">
          <Input
            isNumeric
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        <Field label="Method">
          <Select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
          />
        </Field>

        <Field
          label="Reference"
          hint="The M-Pesa code, cheque number or bank reference."
          isRequired={method === 'mpesa' || method === 'bank_transfer'}
        >
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>

        <Field label="Received on" hint="When the money moved, which may not be today.">
          <Input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>

        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <p className="client-empty">
          A payment cannot be edited or deleted once recorded. A mistake is corrected with a
          reversal, which a manager or the owner can make.
        </p>
      </div>
    </Modal>
  )
}
