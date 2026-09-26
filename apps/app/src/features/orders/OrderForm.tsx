'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Field, Input, Modal, Select, formatMoney } from '@rasko/ui'

import { CURRENCIES, CURRENCY_LABEL, DEFAULT_CURRENCY } from '../invoices/currency.js'
import type { Currency } from '../invoices/currency.js'
import type { DraftLine, OrderType, ProductOption } from './types.js'

/** Client-generated ids, so an order created offline is complete before it syncs. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  )
}

function emptyLine(): DraftLine {
  return { key: newId(), productId: null, description: '', quantity: '1', unitPrice: '0' }
}

export interface OrderFormValues {
  clientId: string | null
  isWalkIn: boolean
  orderType: OrderType
  deliveryAt: string | null
  deliveryAddress: string | null
  /** The book's "Delivery No". */
  deliveryNumber: string | null
  currency: Currency
  eventDate: string | null
  eventVenue: string | null
  eventSetupNotes: string | null
  notes: string | null
  discountCents: number
  lines: DraftLine[]
}

export interface OrderFormProps {
  isOpen: boolean
  onClose: () => void
  products: readonly ProductOption[]
  clients: ReadonlyArray<{ id: string; name: string }>
  onSubmit: (values: OrderFormValues) => Promise<{ error?: string }>
}

export function OrderForm({ isOpen, onClose, products, clients, onSubmit }: OrderFormProps) {
  const [clientId, setClientId] = useState('')
  const [isWalkIn, setIsWalkIn] = useState(false)
  const [orderType, setOrderType] = useState<OrderType>('standard')
  const [deliveryAt, setDeliveryAt] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryNumber, setDeliveryNumber] = useState('')
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY)
  const [eventVenue, setEventVenue] = useState('')
  const [eventSetupNotes, setEventSetupNotes] = useState('')
  const [notes, setNotes] = useState('')
  const [discount, setDiscount] = useState('0')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])

  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  /**
   * Choosing a catalogue product fills the description, and the current price
   * only for a shilling order: catalogue prices are shillings, and there is no
   * exchange rate to convert them with.
   */
  function chooseProduct(key: string, productId: string) {
    if (!productId) {
      updateLine(key, { productId: null })
      return
    }
    const product = products.find((p) => p.id === productId)
    if (!product) return
    updateLine(key, {
      productId,
      description: product.name,
      ...(currency === DEFAULT_CURRENCY ? { unitPrice: String(product.selling_price_cents) } : {}),
    })
  }

  const isForeign = currency !== DEFAULT_CURRENCY
  // Switching currency never rewrites a typed price; it flags shilling prices
  // the catalogue filled in before the switch instead.
  const hasShillingPrices =
    isForeign &&
    lines.some((line) => {
      const product = products.find((p) => p.id === line.productId)
      return (
        product != null &&
        product.selling_price_cents !== 0 &&
        line.unitPrice === String(product.selling_price_cents)
      )
    })

  const subtotal = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity) || 0
    const price = Number(line.unitPrice) || 0
    return sum + Math.round(quantity * price)
  }, 0)
  const total = subtotal - (Number(discount) || 0)

  async function handleSubmit() {
    setError(null)

    if (!isWalkIn && !clientId) {
      setError('Choose a client, or mark this as a walk-in sale.')
      return
    }
    const filled = lines.filter((line) => line.description.trim() !== '')
    if (filled.length === 0) {
      setError('Add at least one line to the order.')
      return
    }
    if (filled.some((line) => (Number(line.quantity) || 0) <= 0)) {
      setError('Every line needs a quantity greater than zero.')
      return
    }
    if (orderType === 'event' && !deliveryAt) {
      setError('An event order needs a delivery date and time.')
      return
    }

    setIsSaving(true)
    const result = await onSubmit({
      clientId: isWalkIn ? null : clientId,
      isWalkIn,
      orderType,
      deliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : null,
      deliveryAddress: deliveryAddress.trim() || null,
      deliveryNumber: deliveryNumber.trim().slice(0, 40) || null,
      currency,
      eventDate: orderType === 'event' && deliveryAt ? deliveryAt.slice(0, 10) : null,
      eventVenue: orderType === 'event' ? eventVenue.trim() || null : null,
      eventSetupNotes: orderType === 'event' ? eventSetupNotes.trim() || null : null,
      notes: notes.trim() || null,
      discountCents: Number(discount) || 0,
      lines: filled,
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
      title="New order"
      description="Saved on this device straight away, and sent to the server when you are online."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            Create order
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

        <Field label="Client" isRequired={!isWalkIn}>
          <Select
            value={isWalkIn ? '' : clientId}
            disabled={isWalkIn}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Choose a client"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>

        {/* FR-3.6: a walk-in sale needs no client record. */}
        <label className="order-checkbox">
          <input
            type="checkbox"
            checked={isWalkIn}
            onChange={(e) => setIsWalkIn(e.target.checked)}
          />
          <span>Walk-in sale, no client record</span>
        </label>

        <Field label="Order type">
          <Select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as OrderType)}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'event', label: 'Event' },
            ]}
          />
        </Field>

        <Field label="Currency" hint="Prices below are keyed in this currency.">
          <Select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            options={CURRENCIES.map((code) => ({ value: code, label: CURRENCY_LABEL[code] }))}
          />
        </Field>

        <Field label="Delivery date and time" isRequired={orderType === 'event'}>
          <Input
            type="datetime-local"
            value={deliveryAt}
            onChange={(e) => setDeliveryAt(e.target.value)}
          />
        </Field>

        <Field label="Delivery address">
          <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
        </Field>

        <Field label="Delivery No" hint="Printed on the invoice.">
          <Input
            value={deliveryNumber}
            maxLength={40}
            onChange={(e) => setDeliveryNumber(e.target.value)}
          />
        </Field>

        {orderType === 'event' ? (
          <>
            <Field label="Venue">
              <Input value={eventVenue} onChange={(e) => setEventVenue(e.target.value)} />
            </Field>
            <Field label="Setup notes">
              <Input value={eventSetupNotes} onChange={(e) => setEventSetupNotes(e.target.value)} />
            </Field>
          </>
        ) : null}

        <div>
          <h3 className="client-section-title">Lines</h3>
          {isForeign ? (
            <p className="rsk-field__hint" id="order-price-hint">
              Catalogue prices are in shillings, so they are not filled in. Key each unit price in{' '}
              {currency} cents.
              {hasShillingPrices
                ? ' Some lines still hold the shilling price filled in before the currency changed.'
                : ''}
            </p>
          ) : null}
          <div className="rsk-stack">
            {lines.map((line) => (
              <div className="order-line" key={line.key}>
                <Select
                  aria-label="Product"
                  value={line.productId ?? ''}
                  onChange={(e) => chooseProduct(line.key, e.target.value)}
                  placeholder="Custom item"
                  options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))}
                />
                <Input
                  aria-label="Description"
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => updateLine(line.key, { description: e.target.value })}
                />
                <Input
                  aria-label="Quantity"
                  inputMode="decimal"
                  isNumeric
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                />
                <Input
                  aria-label={`Unit price in ${currency} cents`}
                  aria-describedby={isForeign ? 'order-price-hint' : undefined}
                  inputMode="numeric"
                  isNumeric
                  value={line.unitPrice}
                  onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                />
                <button
                  type="button"
                  className="rsk-icon-btn"
                  aria-label="Remove line"
                  onClick={() =>
                    setLines((current) =>
                      current.length === 1 ? current : current.filter((l) => l.key !== line.key),
                    )
                  }
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            leadingIcon={<Plus size={14} aria-hidden="true" />}
            onClick={() => setLines((current) => [...current, emptyLine()])}
            className="order-add-line"
          >
            Add line
          </Button>
        </div>

        <Field label={`Order discount in ${currency} cents`}>
          <Input
            isNumeric
            inputMode="numeric"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>

        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="order-totals">
          <span>Subtotal</span>
          <span className="rsk-numeric">{formatMoney(subtotal, currency)}</span>
          <span>Total</span>
          <strong className="rsk-numeric">{formatMoney(total, currency)}</strong>
        </div>
      </div>
    </Modal>
  )
}
