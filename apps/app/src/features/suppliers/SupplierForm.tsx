'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal } from '@rasko/ui'

import type { Supplier } from './types.js'

export interface SupplierFormValues {
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  payment_terms_days: number
  kra_pin: string | null
  notes: string | null
}

/** Loose on purpose: catches a phone number typed into the email box, nothing more. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function SupplierForm({
  isOpen,
  onClose,
  supplier,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  supplier?: Supplier | null
  onSubmit: (values: SupplierFormValues) => Promise<{ error?: string }>
}) {
  const isEdit = Boolean(supplier)

  const [name, setName] = useState(supplier?.name ?? '')
  const [contact, setContact] = useState(supplier?.contact_person ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [email, setEmail] = useState(supplier?.email ?? '')
  const [terms, setTerms] = useState(String(supplier?.payment_terms_days ?? 30))
  const [kraPin, setKraPin] = useState(supplier?.kra_pin ?? '')
  const [notes, setNotes] = useState(supplier?.notes ?? '')

  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit() {
    setError(null)

    if (!name.trim()) return setError('Enter the supplier name.')
    if (email.trim() && !looksLikeEmail(email.trim())) {
      return setError('That does not look like an email address.')
    }

    const termsDays = Number(terms)
    if (!Number.isFinite(termsDays) || termsDays < 0) {
      return setError('Payment terms are a number of days, and cannot be negative.')
    }

    setIsSaving(true)
    const result = await onSubmit({
      name: name.trim(),
      contact_person: contact.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      payment_terms_days: Math.round(termsDays),
      kra_pin: kraPin.trim() || null,
      notes: notes.trim() || null,
    })
    setIsSaving(false)

    if (result.error) setError(result.error)
    else onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit supplier' : 'Add supplier'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving' : 'Save supplier'}
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

        <Field label="Supplier name" isRequired>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <Field label="Contact person">
          <Input value={contact} onChange={(event) => setContact(event.target.value)} />
        </Field>

        <Field label="Phone">
          <Input
            value={phone}
            inputMode="tel"
            placeholder="+254712000000"
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>

        <Field label="Email">
          <Input
            value={email}
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="Payment terms" hint="Days after the purchase date that payment falls due.">
          <Input
            value={terms}
            inputMode="numeric"
            onChange={(event) => setTerms(event.target.value)}
          />
        </Field>

        <Field label="KRA PIN">
          <Input value={kraPin} onChange={(event) => setKraPin(event.target.value)} />
        </Field>

        <Field label="Notes">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
