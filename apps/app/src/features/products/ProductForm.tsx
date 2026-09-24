'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, Select } from '@rasko/ui'

import {
  PRODUCT_UNITS,
  PRODUCT_UNIT_LABEL,
  STEM_FORMS,
  STEM_FORM_HINT,
  STEM_FORM_LABEL,
} from './types.js'
import type { Category, Product, ProductUnit, StemForm } from './types.js'

/**
 * "Baby Blue" + spray -> "BB-SPR"; "Gunni" + standard -> "GUN-STD". A suggestion
 * only: the field stays editable, and uniqueness is checked on save.
 */
export function suggestSku(varietyName: string, form: StemForm): string {
  const words = varietyName.trim().split(/\s+/).filter(Boolean)
  const stem =
    words.length > 1
      ? words.map((word) => word[0]).join('')
      : (words[0] ?? '').replace(/[^a-z]/gi, '').slice(0, 3)
  return `${stem.toUpperCase()}-${form === 'spray' ? 'SPR' : 'STD'}`
}

export function suggestName(varietyName: string, form: StemForm): string {
  return `${varietyName.trim()} ${form === 'spray' ? 'spray' : 'standard'}`
}

/** Prices are typed in shillings and stored as integer cents (PRD §7). */
function toCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN
}

export interface ProductFormValues {
  sku: string
  name: string
  category_id: string
  stem_form: StemForm
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
  const [stemForm, setStemForm] = useState<StemForm>(product?.stem_form ?? 'standard')
  // Name and SKU follow the variety and form until the user types their own.
  const [isNameTouched, setIsNameTouched] = useState(isEdit)
  const [isSkuTouched, setIsSkuTouched] = useState(isEdit)
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
    if (!categoryId) return setError('Choose a variety.')

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
      stem_form: stemForm,
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

  const varietyName = categories.find((c) => c.id === categoryId)?.name ?? ''
  function suggest(nextCategoryId: string, nextForm: StemForm) {
    const nextVariety = categories.find((c) => c.id === nextCategoryId)?.name ?? ''
    if (!nextVariety) return
    if (!isNameTouched) setName(suggestName(nextVariety, nextForm))
    if (!isSkuTouched) setSku(suggestSku(nextVariety, nextForm))
  }

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

        <Field label="Variety" isRequired>
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value)
              suggest(e.target.value, stemForm)
            }}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>

        <fieldset className="product-form__forms">
          <legend className="rsk-field__label">
            Form<span className="rsk-field__required">*</span>
          </legend>
          <div className="product-form__form-options">
            {STEM_FORMS.map((form) => (
              <label
                key={form}
                className={
                  form === stemForm
                    ? 'product-form__form product-form__form--active'
                    : 'product-form__form'
                }
              >
                <input
                  type="radio"
                  name="stem-form"
                  value={form}
                  checked={form === stemForm}
                  onChange={() => {
                    setStemForm(form)
                    suggest(categoryId, form)
                  }}
                />
                <span className="product-form__form-name">{STEM_FORM_LABEL[form]}</span>
                <span className="product-form__form-hint">{STEM_FORM_HINT[form]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field
          label="Name"
          isRequired
          {...(varietyName
            ? { hint: 'Add a grade or length if you sell more than one, e.g. 60 cm.' }
            : {})}
        >
          <Input
            value={name}
            onChange={(e) => {
              setIsNameTouched(true)
              setName(e.target.value)
            }}
          />
        </Field>

        <Field label="SKU" isRequired hint="A short code, unique to this product.">
          <Input
            value={sku}
            onChange={(e) => {
              setIsSkuTouched(true)
              setSku(e.target.value)
            }}
            disabled={isEdit}
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
