'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, Select } from '@rasko/ui'

import { CLIENT_TYPES, CLIENT_TYPE_LABEL } from './types.js'
import type { Client, ClientType } from './types.js'

/** FR-3.1. Kenyan mobile numbers, stored E.164 (+254...). */
function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  if (!digits) return null
  const national = digits.startsWith('254') ? digits.slice(3) : digits.replace(/^0+/, '')
  return `+254${national}`
}

function isValidPhone(input: string): boolean {
  if (!input.trim()) return true // optional
  const normalised = normalisePhone(input)
  return normalised !== null && /^\+254[17]\d{8}$/.test(normalised)
}

/**
 * Deliberately loose: something@something.something, no more.
 *
 * The field is optional and a client's address is whatever they actually use;
 * a stricter pattern rejects valid addresses. This only catches the obvious
 * mistake — a phone number typed into the wrong box, which is exactly what
 * happened during the first walkthrough of this form.
 */
function isValidEmail(input: string): boolean {
  if (!input.trim()) return true // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())
}

export interface ClientFormValues {
  name: string
  client_type: ClientType
  phone: string | null
  email: string | null
  kra_pin: string | null
  address: string | null
  credit_terms_days: number
  notes: string | null
}

export interface ClientFormProps {
  isOpen: boolean
  onClose: () => void
  /** Present when editing; absent when creating. */
  client?: Client | null
  onSubmit: (values: ClientFormValues) => Promise<{ error?: string }>
}

export function ClientForm({ isOpen, onClose, client, onSubmit }: ClientFormProps) {
  const isEdit = Boolean(client)

  const [name, setName] = useState(client?.name ?? '')
  const [type, setType] = useState<ClientType>(client?.client_type ?? 'individual')
  const [phone, setPhone] = useState(client?.phone ?? '')
  const [email, setEmail] = useState(client?.email ?? '')
  const [kraPin, setKraPin] = useState(client?.kra_pin ?? '')
  const [address, setAddress] = useState(client?.address ?? '')
  const [terms, setTerms] = useState(String(client?.credit_terms_days ?? 0))
  const [notes, setNotes] = useState(client?.notes ?? '')

  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit() {
    setError(null)

    if (!name.trim()) {
      setError('Enter the client name.')
      return
    }
    if (!isValidPhone(phone)) {
      setError('Enter a Kenyan mobile number, for example 0712 004 518.')
      return
    }
    if (!isValidEmail(email)) {
      setError('Enter a valid email address, or leave it blank.')
      return
    }
    const termDays = Number(terms)
    if (!Number.isInteger(termDays) || termDays < 0) {
      setError('Credit terms must be a whole number of days.')
      return
    }

    setIsSaving(true)
    const result = await onSubmit({
      name: name.trim(),
      client_type: type,
      phone: phone.trim() ? normalisePhone(phone) : null,
      email: email.trim() || null,
      kra_pin: kraPin.trim() || null,
      address: address.trim() || null,
      credit_terms_days: termDays,
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
      title={isEdit ? 'Edit client' : 'Add client'}
      description={
        isEdit
          ? 'Changes are saved on this device and sent to the server when you are online.'
          : 'Saved on this device straight away, and sent to the server when you are online.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            {isEdit ? 'Save changes' : 'Add client'}
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

        <Field label="Name" isRequired>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Type">
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as ClientType)}
            options={CLIENT_TYPES.map((t) => ({ value: t, label: CLIENT_TYPE_LABEL[t] }))}
          />
        </Field>

        <Field label="Phone" hint="Kenyan mobile, for example 0712 004 518.">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>

        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <Field label="KRA PIN" hint="Mainly for corporate clients. Appears on their invoices.">
          <Input value={kraPin} onChange={(e) => setKraPin(e.target.value)} />
        </Field>

        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <Field
          label="Credit terms"
          hint="Days before an invoice falls due. Zero means on delivery."
        >
          <Input
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            inputMode="numeric"
            isNumeric
          />
        </Field>

        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
