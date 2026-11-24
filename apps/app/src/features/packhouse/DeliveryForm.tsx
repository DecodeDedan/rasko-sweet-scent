'use client'

import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button, Field, Input, Modal, Select } from '@rasko/ui'

import { newId } from '../../data/ids.js'
import type { NewDelivery } from './types.js'

interface Props {
  clients: ReadonlyArray<{ id: string; name: string }>
  products: ReadonlyArray<{ id: string; name: string }>
  today: string
  onClose: () => void
  onSubmit: (values: Omit<NewDelivery, 'id'>) => Promise<{ error?: string }>
}

interface DraftLine {
  key: string
  productId: string
  stemLength: string
  quantity: string
}

const blankLine = (): DraftLine => ({ key: newId(), productId: '', stemLength: '', quantity: '' })

/** What leaves the farm: the delivery note, line by line, before the pack house counts it. */
export function DeliveryForm({ clients, products, today, onClose, onSubmit }: Props) {
  const [clientId, setClientId] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(today)
  const [deliveryNote, setDeliveryNote] = useState('')
  const [gatepass, setGatepass] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const patchLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  async function handleSubmit() {
    setError(null)
    setIsSaving(true)
    const result = await onSubmit({
      clientId,
      deliveryDate,
      deliveryNoteNumber: deliveryNote || null,
      gatepassNumber: gatepass || null,
      notes: notes || null,
      lines: lines.map((line) => ({
        id: line.key,
        productId: line.productId,
        stemLengthCm: line.stemLength.trim() ? Number(line.stemLength) : null,
        quantitySent: Number(line.quantity),
      })),
    })
    setIsSaving(false)
    if (result.error) setError(result.error)
    else onClose()
  }

  return (
    <Modal
      isOpen
      size="lg"
      onClose={onClose}
      title="Record a delivery to a pack house"
      description="Enter the delivery note as it left the farm. The pack house's counts are recorded when its intake report comes back."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} isLoading={isSaving}>
            Record delivery
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

        <Field
          label="Pack house"
          isRequired
          hint="Pack houses are clients. Add one under Clients first."
        >
          <Select
            value={clientId}
            placeholder="Choose the pack house"
            onChange={(event) => setClientId(event.target.value)}
            options={clients.map((client) => ({ value: client.id, label: client.name }))}
          />
        </Field>

        <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Field label="Delivery date" isRequired>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(event) => setDeliveryDate(event.target.value)}
            />
          </Field>
          <Field label="Delivery note number">
            <Input value={deliveryNote} onChange={(event) => setDeliveryNote(event.target.value)} />
          </Field>
          <Field label="Gate pass number">
            <Input value={gatepass} onChange={(event) => setGatepass(event.target.value)} />
          </Field>
        </div>

        {lines.map((line, index) => (
          <fieldset
            key={line.key}
            className="rsk-row"
            style={{ flexWrap: 'wrap', alignItems: 'flex-end', border: 0, padding: 0, margin: 0 }}
          >
            <legend className="rsk-visually-hidden">Line {index + 1}</legend>
            <Field label="Variety" isRequired>
              <Select
                value={line.productId}
                placeholder="Choose a variety"
                onChange={(event) => patchLine(line.key, { productId: event.target.value })}
                options={products.map((product) => ({ value: product.id, label: product.name }))}
              />
            </Field>
            <Field label="Stem length (cm)">
              <Input
                value={line.stemLength}
                inputMode="numeric"
                isNumeric
                onChange={(event) => patchLine(line.key, { stemLength: event.target.value })}
              />
            </Field>
            <Field label="Stems on delivery note" isRequired>
              <Input
                value={line.quantity}
                inputMode="numeric"
                isNumeric
                onChange={(event) => patchLine(line.key, { quantity: event.target.value })}
              />
            </Field>
            {lines.length > 1 ? (
              <Button
                variant="ghost"
                aria-label={`Remove line ${index + 1}`}
                onClick={() =>
                  setLines((current) => current.filter((other) => other.key !== line.key))
                }
              >
                <X size={14} aria-hidden="true" />
              </Button>
            ) : null}
          </fieldset>
        ))}

        <Button
          variant="secondary"
          leadingIcon={<Plus size={15} aria-hidden="true" />}
          onClick={() => setLines((current) => [...current, blankLine()])}
        >
          Add variety
        </Button>

        <Field label="Notes">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
