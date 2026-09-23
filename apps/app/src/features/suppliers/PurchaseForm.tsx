'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Field, Input, Modal, Select, formatKes } from '@rasko/ui'

import type { NewPurchaseLine, SupplierSummary } from './types.js'

interface DraftLine {
  key: string
  productId: string
  quantity: string
  unitCost: string
}

export interface ProductOption {
  id: string
  name: string
  sku: string
  costCents: number
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `line-${Math.random().toString(16).slice(2)}`
}

function emptyLine(): DraftLine {
  return { key: newKey(), productId: '', quantity: '1', unitCost: '0.00' }
}

/** Costs are typed in shillings, stored as integer cents (PRD §7). */
function toCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN
}

/** due_date defaults from the supplier's terms — the reason we store them (FR-7.1). */
function dueDateFor(purchaseDate: string, termsDays: number): string {
  const base = new Date(`${purchaseDate}T00:00:00.000Z`)
  if (Number.isNaN(base.getTime())) return purchaseDate
  base.setUTCDate(base.getUTCDate() + termsDays)
  return base.toISOString().slice(0, 10)
}

export function PurchaseForm({
  isOpen,
  onClose,
  suppliers,
  products,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  suppliers: readonly SupplierSummary[]
  products: readonly ProductOption[]
  onSubmit: (input: {
    supplierId: string
    purchaseDate: string
    dueDate: string
    lines: NewPurchaseLine[]
  }) => Promise<{ error?: string }>
}) {
  const today = new Date().toISOString().slice(0, 10)

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [purchaseDate, setPurchaseDate] = useState(today)
  const [dueDate, setDueDate] = useState(dueDateFor(today, suppliers[0]?.payment_terms_days ?? 30))
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  function chooseSupplier(id: string) {
    setSupplierId(id)
    const supplier = suppliers.find((candidate) => candidate.id === id)
    if (supplier) setDueDate(dueDateFor(purchaseDate, supplier.payment_terms_days))
  }

  function changeDate(value: string) {
    setPurchaseDate(value)
    const supplier = suppliers.find((candidate) => candidate.id === supplierId)
    setDueDate(dueDateFor(value, supplier?.payment_terms_days ?? 30))
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  /** Picking a product seeds its last known cost, which is usually right. */
  function chooseProduct(key: string, productId: string) {
    const product = products.find((candidate) => candidate.id === productId)
    updateLine(key, {
      productId,
      ...(product ? { unitCost: (product.costCents / 100).toFixed(2) } : {}),
    })
  }

  const total = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity)
    const cost = toCents(line.unitCost)
    if (!Number.isFinite(quantity) || !Number.isFinite(cost)) return sum
    return sum + Math.round(quantity * cost)
  }, 0)

  async function handleSubmit() {
    setError(null)

    if (!supplierId) return setError('Choose a supplier.')

    const prepared: NewPurchaseLine[] = []
    for (const line of lines) {
      if (!line.productId) return setError('Every line needs a product.')

      const quantity = Number(line.quantity)
      const unitCostCents = toCents(line.unitCost)

      if (!Number.isFinite(quantity) || quantity <= 0) {
        return setError('Every line needs a quantity above zero.')
      }
      if (!Number.isFinite(unitCostCents) || unitCostCents < 0) {
        return setError('Enter a valid unit cost on every line.')
      }
      prepared.push({ productId: line.productId, quantity, unitCostCents })
    }

    if (prepared.length === 0) return setError('Add at least one line.')

    setIsSaving(true)
    const result = await onSubmit({ supplierId, purchaseDate, dueDate, lines: prepared })
    setIsSaving(false)

    if (result.error) setError(result.error)
    else onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record purchase"
      description="Stock only moves once you confirm the delivery was received."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving' : 'Save purchase'}
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

        <Field label="Supplier" isRequired>
          <Select
            value={supplierId}
            onChange={(event) => chooseSupplier(event.target.value)}
            options={suppliers.map((supplier) => ({
              value: supplier.id,
              label: supplier.name,
            }))}
          />
        </Field>

        <Field label="Purchase date" isRequired>
          <Input
            type="date"
            value={purchaseDate}
            onChange={(event) => changeDate(event.target.value)}
          />
        </Field>

        <Field label="Payment due" hint="Defaults from the supplier's payment terms.">
          <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>

        {lines.map((line, index) => (
          <div key={line.key} className="rsk-stack">
            <Field label={`Line ${index + 1} — product`} isRequired>
              <Select
                value={line.productId}
                onChange={(event) => chooseProduct(line.key, event.target.value)}
                options={[
                  { value: '', label: 'Choose a product' },
                  ...products.map((product) => ({
                    value: product.id,
                    label: `${product.name} (${product.sku})`,
                  })),
                ]}
              />
            </Field>

            <Field label="Quantity" isRequired>
              <Input
                value={line.quantity}
                inputMode="decimal"
                onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
              />
            </Field>

            <Field label="Unit cost" isRequired>
              <Input
                value={line.unitCost}
                inputMode="decimal"
                onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
              />
            </Field>

            {lines.length > 1 ? (
              <Button
                variant="ghost"
                leadingIcon={<Trash2 size={15} aria-hidden="true" />}
                onClick={() =>
                  setLines((current) => current.filter((candidate) => candidate.key !== line.key))
                }
              >
                Remove line {index + 1}
              </Button>
            ) : null}
          </div>
        ))}

        <Button
          variant="secondary"
          onClick={() => setLines((current) => [...current, emptyLine()])}
        >
          Add line
        </Button>

        <p className="rsk-numeric">Total {formatKes(total)}</p>
      </div>
    </Modal>
  )
}
