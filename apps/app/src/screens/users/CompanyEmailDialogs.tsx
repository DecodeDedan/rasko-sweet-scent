'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, Select } from '@rasko/ui'

import type { AssignResult, AuthGateway } from '../../auth/gateway.js'
import { ROLE_LABEL } from '../../auth/session.js'
import type { ProfileRecord, Role } from '../../auth/session.js'
// The same address rules the server applies (docs/company-email.md), so the
// address previewed here is the one that gets created.
import {
  companyAddress,
  suggestLocalPart,
} from '../../../../../supabase/functions/_shared/mailbox/routing.js'

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'

/** Live preview of the address, or the reason it would be refused. */
function addressHint(localPart: string, domain: string): { hint?: string; error?: string } {
  if (!localPart.trim()) return { hint: `Their company address will end in @${domain}.` }
  const result = companyAddress(localPart, domain)
  return result.error !== undefined
    ? { error: result.error }
    : { hint: `Their company address: ${result.address}` }
}

/**
 * FR-1.4 with a company address: the owner names the person, their own inbox
 * and the address; the server creates the address, forwards it to that inbox
 * and sends the invitation there. Mounted only while open (see LoginScreen).
 */
export function InviteUserDialog({
  gateway,
  offeredRoles,
  onClose,
  onInvited,
}: {
  gateway: AuthGateway
  offeredRoles: readonly Role[]
  onClose: () => void
  onInvited: (address: string) => void
}) {
  const domain = gateway.staffEmailDomain
  const [fullName, setFullName] = useState('')
  const [personalEmail, setPersonalEmail] = useState('')
  // Follows the name until the owner types their own.
  const [customLocalPart, setCustomLocalPart] = useState<string | null>(null)
  const [role, setRole] = useState<Role>('sales')
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  const localPart = customLocalPart ?? suggestLocalPart(fullName)
  const preview = addressHint(localPart, domain)

  async function send() {
    setError(null)
    const address = companyAddress(localPart, domain)
    if (!fullName.trim()) return setError("Enter the person's full name.")
    if (!personalEmail.includes('@')) {
      return setError('Enter the personal email their company mail should be delivered to.')
    }
    if (address.error !== undefined) return setError(address.error)
    if (personalEmail.trim().toLowerCase().endsWith(`@${domain}`)) {
      return setError('The personal email must be their own inbox, not a company address.')
    }

    setIsSending(true)
    try {
      const result = await gateway.inviteUser({ fullName, role, localPart, personalEmail })
      if (result.error) return setError(result.error)
      onInvited(address.address)
    } catch {
      setError(UNREACHABLE)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Invite a user"
      description="They get a company email address and an invitation in their own inbox, and choose their own password."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void send()} isLoading={isSending}>
            Send invitation
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
        <Field label="Full name" isRequired>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field
          label="Personal email"
          isRequired
          hint="Their own inbox, such as Gmail. Company mail is delivered here, and so is the invitation."
        >
          <Input
            type="email"
            autoComplete="off"
            value={personalEmail}
            onChange={(e) => setPersonalEmail(e.target.value)}
          />
        </Field>
        <Field label="Company email" isRequired {...preview}>
          <Input
            autoComplete="off"
            spellCheck={false}
            value={localPart}
            onChange={(e) => setCustomLocalPart(e.target.value)}
          />
        </Field>
        <Field label="Role" hint="You can change this later.">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={offeredRoles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
        </Field>
      </div>
    </Modal>
  )
}

/**
 * Moves an existing account onto a company address. Its current email keeps
 * receiving the mail; only the sign-in address changes.
 */
export function AssignCompanyEmailDialog({
  gateway,
  target,
  isSelf,
  onClose,
  onAssigned,
}: {
  gateway: AuthGateway
  target: ProfileRecord
  isSelf: boolean
  onClose: () => void
  onAssigned: (address: string, result: AssignResult) => void
}) {
  const domain = gateway.staffEmailDomain
  const [localPart, setLocalPart] = useState(() => suggestLocalPart(target.fullName))
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const preview = addressHint(localPart, domain)

  async function save() {
    setError(null)
    const address = companyAddress(localPart, domain)
    if (address.error !== undefined) return setError(address.error)
    setIsSaving(true)
    try {
      const result = await gateway.assignCompanyEmail(target.id, localPart)
      if (result.error) return setError(result.error)
      onAssigned(address.address, result)
    } catch {
      setError(UNREACHABLE)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title="Give a company email"
      description={
        isSelf
          ? `Mail to your new address is delivered to ${target.email}. You sign in with the new address from now on; your password stays the same.`
          : `Mail to the new address is delivered to ${target.email}. ${target.fullName} signs in with it from now on; their password stays the same.`
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} isLoading={isSaving}>
            Create address
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
        <Field label="Company email" isRequired {...preview}>
          <Input
            autoComplete="off"
            spellCheck={false}
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
