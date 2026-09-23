'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, Select } from '@rasko/ui'

import { PRODUCT_UNITS, PRODUCT_UNIT_LABEL } from './types.js'
import type { Category, Product, ProductUnit } from './types.js'

/** Prices are typed in shillings and stored as integer cents (PRD §7). */
function toCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN
}

export interface ProductFormValues {
  sku: string
  name: string
  category_id: string
  unit: ProductUnit
  cost_price_cents: number
  selling_price_cents: number
  low_stock_threshold: number
  is_active: boolean
}

export function ProductForm({
  isOpen,
  onClose,
  product,
  categories,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  product?: Product | null
  categories: readonly Category[]
  onSubmit: (values: ProductFormValues) => Promise<{ error?: string }>
}) {
  const isEdit = Boolean(product)

  const [sku, setSku] = useState(product?.sku ?? '')
  const [name, setName] = useState(product?.name ?? '')
  const [categoryId, setCategoryId] = useState(product?.category_id ?? categories[0]?.id ?? '')
  const [unit, setUnit] = useState<ProductUnit>(product?.unit ?? 'stem')
  const [cost, setCost] = useState(((product?.cost_price_cents ?? 0) / 100).toFixed(2))
  const [price, setPrice] = useState(((product?.selling_price_cents ?? 0) / 100).toFixed(2))
  const [threshold, setThreshold] = useState(String(product?.low_stock_threshold ?? 0))
  const [isActive, setIsActive] = useState(product?.is_active ?? true)

  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit() {
    setError(null)

    if (!sku.trim()) return setError('Enter a SKU.')
    if (!name.trim()) return setError('Enter a product name.')
    if (!categoryId) return setError('Choose a category.')

    const costCents = toCents(cost)
    const priceCents = toCents(price)
    const thresholdValue = Number(threshold)

    if (!Number.isFinite(costCents) || costCents < 0) return setError('Enter a valid cost price.')
    if (!Number.isFinite(priceCents) || priceCents < 0)
      return setError('Enter a valid selling price.')
    if (!Number.isFinite(thresholdValue) || thresholdValue < 0) {
      return setError('The low-stock threshold cannot be negative.')
    }

    setIsSaving(true)
    const result = await onSubmit({
      sku: sku.trim().toUpperCase(),
      name: name.trim(),
      category_id: categoryId,
      unit,
      cost_price_cents: costCents,
      selling_price_cents: priceCents,
      low_stock_threshold: thresholdValue,
      is_active: isActive,
    })
    setIsSaving(false)
    if (result.error) return setError(result.error)
    onClose()
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit product' : 'Add product'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            {isEdit ? 'Save changes' : 'Add product'}
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

        <Field label="SKU" isRequired hint="A short code, unique to this product.">
          <Input value={sku} onChange={(e) => setSku(e.target.value)} disabled={isEdit} />
        </Field>

        <Field label="Name" isRequired>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Category" isRequired>
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>

        <Field label="Unit">
          <Select
            value={unit}
            onChange={(e) => setUnit(e.target.value as ProductUnit)}
            options={PRODUCT_UNITS.map((u) => ({ value: u, label: PRODUCT_UNIT_LABEL[u] }))}
          />
        </Field>

        <Field label="Cost price in shillings" hint="What it costs you. Used for stock valuation.">
          <Input
            isNumeric
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </Field>

        <Field label="Selling price in shillings">
          <Input
            isNumeric
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>

        <Field label="Low-stock threshold" hint="Warn when stock reaches this level or below.">
          <Input
            isNumeric
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </Field>

        <label className="order-checkbox">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>Active, and offered when taking an order</span>
        </label>

        <p className="client-empty">
          Stock is not set here. It is the sum of recorded movements, so it changes by recording a
          purchase, wastage or adjustment.
        </p>
      </div>
    </Modal>
  )
}
