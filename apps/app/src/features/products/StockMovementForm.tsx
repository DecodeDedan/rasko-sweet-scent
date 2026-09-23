'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, Select, formatQuantity } from '@rasko/ui'

import { MANUAL_MOVEMENT_TYPES, MOVEMENT_TYPE_LABEL, reasonRequired, signFor } from './types.js'
import type { MovementType, ProductStock } from './types.js'

/** FR-6.2 / FR-6.5. Sales are not here: the order pipeline writes those. */
export function StockMovementForm({
  isOpen,
  onClose,
  product,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  product: ProductStock
  onSubmit: (values: {
    type: MovementType
    quantity: number
    reason: string | null
  }) => Promise<{ error?: string }>
}) {
  const [type, setType] = useState<MovementType>('wastage')
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const amount = Number(quantity)
  const sign = signFor(type)
  const projected =
    Number.isFinite(amount) && amount !== 0
      ? product.currentStock + (sign === 0 ? amount : Math.abs(amount) * sign)
      : product.currentStock

  async function handleSubmit() {
    setError(null)
    if (!Number.isFinite(amount) || amount === 0)
      return setError('Enter a quantity other than zero.')
    if (reasonRequired(type) && !reason.trim()) return setError('Give a reason for this movement.')

    setIsSaving(true)
    const result = await onSubmit({ type, quantity: amount, reason: reason.trim() || null })
    setIsSaving(false)
    if (result.error) return setError(result.error)
    onClose()
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Record stock movement — ${product.name}`}
      description={`Currently ${formatQuantity(product.currentStock, product.unit)}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            Record movement
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

        <Field label="Type">
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as MovementType)}
            options={MANUAL_MOVEMENT_TYPES.map((t) => ({
              value: t,
              label: MOVEMENT_TYPE_LABEL[t],
            }))}
          />
        </Field>

        <Field
          label="Quantity"
          isRequired
          hint={
            sign === 0
              ? 'An adjustment may be positive or negative.'
              : `Enter a positive amount; a ${MOVEMENT_TYPE_LABEL[type].toLowerCase()} ${sign > 0 ? 'adds to' : 'reduces'} stock.`
          }
        >
          <Input
            isNumeric
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>

        <Field
          label="Reason"
          isRequired={reasonRequired(type)}
          hint={
            reasonRequired(type)
              ? 'Required. Wastage and adjustments are reviewed, so they must explain themselves.'
              : 'Optional.'
          }
        >
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <div className="order-totals">
          <span>Stock after this movement</span>
          <strong className="rsk-numeric">{formatQuantity(projected, product.unit)}</strong>
        </div>

        {projected < 0 ? (
          <p className="client-empty">
            This leaves stock negative. That is allowed — it usually means a sale was recorded
            before the purchase — and the product is flagged for review.
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
